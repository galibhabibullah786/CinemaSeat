# Deploying to AWS EC2

This is the end-to-end procedure for standing up the production target
and connecting it to the CD pipeline.

The pipeline authenticates to AWS with **OpenID Connect** and executes
the deploy with **SSM Run Command**. There is no AWS access key, no SSH
private key in GitHub, and no inbound SSH rule on the instance. The
reasoning is in [ADR-0010](adr/0010-oidc-ssm-deploy-to-ec2.md); this
document is the runnable version of it.

**Time to complete:** ~45 minutes, once. **Prerequisites:** an AWS
account with permission to create IAM roles, and the AWS CLI v2
configured locally.

---

## Contents

1. [What you are building](#1-what-you-are-building)
2. [Launch the instance](#2-launch-the-instance)
3. [Prepare the host](#3-prepare-the-host)
4. [Create the GitHub OIDC provider](#4-create-the-github-oidc-provider)
5. [Create the deploy role](#5-create-the-deploy-role)
6. [Give the instance its own role](#6-give-the-instance-its-own-role)
7. [Store the GHCR pull token](#7-store-the-ghcr-pull-token)
8. [Wire up GitHub](#8-wire-up-github)
9. [First deploy](#9-first-deploy)
10. [Rollback](#10-rollback)
11. [Troubleshooting](#11-troubleshooting)
12. [Teardown](#12-teardown)

---

## 1. What you are building

```
  push to main
       |
       v
  +----------+   builds, scans, pushes images (ADR-0009)
  |    ci    |-------------------------------------> ghcr.io/<owner>/baseplate-*
  +----------+
       | workflow_run: success
       v
  +----------+
  |    cd    |  1. verify-images  -- assert the tag exists in GHCR
  +----------+  2. OIDC ---> AWS STS ---> 30-minute credentials
       |        3. ssm:SendCommand
       v
  +---------------------------+
  |  EC2 instance             |   SSM agent polls OUTBOUND on 443.
  |    SSM agent              |   No inbound rule is needed for deploys.
  |    /opt/baseplate         |
  |      scripts/deploy.sh    |   pull -> up -> healthy -> migrate -> /ready
  |      docker compose       |
  +---------------------------+
       |
       :8080 (or 443 behind a proxy)   <-- the only ingress
```

Three principals, each with the smallest set of rights that works:

| Principal | Is | Can |
| --- | --- | --- |
| `BaseplateGithubDeployRole` | assumed by the CD job, via OIDC | send one SSM document to one instance |
| `BaseplateInstanceRole` | attached to the EC2 instance | be managed by SSM; read `/baseplate/*` parameters |
| GHCR token | a read-only package token | pull images |

Notation: `<owner>` is your GitHub org or user, `<repo>` the repository
name, `<account-id>` your 12-digit AWS account id, and `<region>`
e.g. `ap-southeast-1`. Set them as shell variables so the commands below
paste cleanly:

```bash
export AWS_REGION=ap-southeast-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export GH_OWNER=your-github-user-or-org
export GH_REPO=your-repo-name
```

---

## 2. Launch the instance

| Setting | Value | Why |
| --- | --- | --- |
| AMI | Amazon Linux 2023 (x86_64) | The SSM agent is preinstalled and enabled. Ubuntu 22.04+ works too — see the note below. |
| Instance type | `t3.small` (2 vCPU / 2 GB) minimum | The stack runs Postgres + Node + nginx. `t3.micro` (1 GB) will OOM under `compose.prod`'s limits: the API and db are capped at 512M each. |
| Storage | 20 GB gp3 | Images (~400 MB), the Postgres volume, and container logs (capped at 10 MB × 3 per service). |
| Key pair | **Proceed without a key pair** | Deploys go through SSM. If you want a break-glass shell, use `aws ssm start-session`, which also needs no key. |
| IAM instance profile | leave empty for now — [step 6](#6-give-the-instance-its-own-role) | |

Security group — this is the whole ruleset:

| Direction | Port | Source/Dest | Why |
| --- | --- | --- | --- |
| Inbound | 8080 (or 443) | `0.0.0.0/0` | The published web port. This is the only service `compose.prod.yaml` exposes. |
| Outbound | 443 | `0.0.0.0/0` | SSM agent polling, and `docker pull` from GHCR. |

No inbound 22. No inbound 5432 — Postgres publishes no port at all, and
the `backend` compose network is `internal: true`, so the database and
the API have no route off the host in either direction.

> **Ubuntu instead of Amazon Linux 2023?** The SSM agent is preinstalled
> as a snap on Ubuntu 18.04+ but you must confirm it is running
> (`snap services amazon-ssm-agent`), and the AWS CLI is not installed
> by default — [step 7](#7-store-the-ghcr-pull-token) needs it. Install
> with `sudo snap install aws-cli --classic`.

---

## 3. Prepare the host

Connect without SSH:

```bash
aws ssm start-session --target i-0123456789abcdef0
```

If that fails, the instance role from [step 6](#6-give-the-instance-its-own-role)
is not attached yet. Attach it and wait ~1 minute for the agent to
register.

Install Docker and lay out the deploy directory:

```bash
sudo dnf install -y docker git            # Amazon Linux 2023
sudo systemctl enable --now docker

# The compose plugin is not in the AL2023 repos; install it as a CLI plugin.
DOCKER_CONFIG=/usr/local/lib/docker
sudo mkdir -p $DOCKER_CONFIG/cli-plugins
sudo curl -fsSL \
  https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 \
  -o $DOCKER_CONFIG/cli-plugins/docker-compose
sudo chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose
docker compose version

# The deploy directory. SSM commands run as root, so root owns it.
sudo mkdir -p /opt/baseplate
sudo git clone https://github.com/<owner>/<repo>.git /opt/baseplate
```

> **Why is the repository on the production host at all?** The pipeline
> deploys *images*, not source. The checkout is there for
> `docker/compose.prod.yaml` and `scripts/*.sh` — the topology and the
> deploy sequence, not the application. Keeping them in git means the
> stack definition on the host is reviewable and versioned rather than a
> file somebody edited over a session.

Create the environment file. It is **not** in git — it holds the
database password.

```bash
sudo cp /opt/baseplate/.env.example /opt/baseplate/.env
sudo chmod 600 /opt/baseplate/.env
sudo vi /opt/baseplate/.env
```

Set at minimum:

```ini
POSTGRES_USER=baseplate
POSTGRES_PASSWORD=DRY3JhagBrp5dCGmRupinU4OciGdKJo02WQU/CbjIj8=
POSTGRES_DB=baseplate

GHCR_REGISTRY=ghcr.io
GHCR_NAMESPACE=galibhabibullah786          # lowercase; GHCR namespaces are case-sensitive

WEB_PORT=8080
CORS_ORIGINS=ec2-18-138-224-242.ap-southeast-1.compute.amazonaws.com      # or http://<public-ip>:8080
```

Leave `IMAGE_TAG=latest` as it is. Every deploy overrides it with the
immutable `sha-<short>` tag, and `scripts/deploy.sh` gives a
caller-supplied value precedence over the file.

---

## 4. Create the GitHub OIDC provider

One per AWS account. Skip if you already have one — check with
`aws iam list-open-id-connect-providers`.

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

This is the trust anchor: it tells AWS that JWTs signed by GitHub's
Actions issuer may be presented to STS. It grants nothing on its own —
the role's trust policy in the next step decides *which* GitHub
workflows may use it.

> The thumbprint is no longer validated by AWS for this issuer (it is
> verified against the published JWKS), but the API still requires the
> field.

---

## 5. Create the deploy role

This is the role the CD job assumes. Two documents: **who may assume it**
and **what it may do**.

### Trust policy — who

```bash
cat > /tmp/trust-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:${GH_OWNER}/${GH_REPO}:environment:production"
      }
    }
  }]
}
JSON

aws iam create-role \
  --role-name BaseplateGithubDeployRole \
  --description "Assumed by GitHub Actions CD to deploy baseplate to EC2" \
  --assume-role-policy-document file:///tmp/trust-policy.json \
  --max-session-duration 3600
```

The `sub` condition is the security boundary, and it is worth being
precise about:

- `repo:<owner>/<repo>:environment:production` — only jobs in **this**
  repository that declare `environment: production` can assume the role.
  `cd.yml`'s `deploy-ec2` job does; nothing else in the repository does.
- Do **not** use `repo:<owner>/<repo>:*`. That matches every branch and
  every pull request. Anyone who can open a PR could then assume your
  deploy role.
- Do **not** use `StringLike` with a wildcard on the org
  (`repo:<owner>/*`). One compromised repository in the org becomes a
  compromised production deploy.

### Permission policy — what

```bash
INSTANCE_ID=i-0123456789abcdef0

cat > /tmp/deploy-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendDeployCommandToOneInstance",
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:${AWS_REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}",
        "arn:aws:ssm:${AWS_REGION}::document/AWS-RunShellScript"
      ]
    },
    {
      "Sid": "ReadBackTheResult",
      "Effect": "Allow",
      "Action": [
        "ssm:GetCommandInvocation",
        "ssm:ListCommandInvocations",
        "ssm:ListCommands"
      ],
      "Resource": "*"
    }
  ]
}
JSON

aws iam put-role-policy \
  --role-name BaseplateGithubDeployRole \
  --policy-name BaseplateDeploy \
  --policy-document file:///tmp/deploy-policy.json
```

Both ARNs in the first statement are required and they do different
work: the instance ARN restricts *where* the command may run, the
document ARN restricts *what* may be run. Omit the instance ARN and the
role can shell into every instance in the account; omit the document ARN
and `SendCommand` is denied outright.

`ssm:GetCommandInvocation` does not support resource-level permissions,
hence the `"*"`. It is a read of a command's output, and reaching it
requires a command id that only `SendCommand` produces.

Note the role ARN — you need it in [step 8](#8-wire-up-github):

```bash
aws iam get-role --role-name BaseplateGithubDeployRole \
  --query Role.Arn --output text
```

---

## 6. Give the instance its own role

Separate from the deploy role, and for a different reason: the instance
needs to be *manageable* by SSM, and it needs to read its own GHCR
token.

```bash
cat > /tmp/ec2-trust.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
JSON

aws iam create-role \
  --role-name BaseplateInstanceRole \
  --assume-role-policy-document file:///tmp/ec2-trust.json

# The AWS-managed policy that lets the SSM agent register and take commands.
aws iam attach-role-policy \
  --role-name BaseplateInstanceRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

# Read ONLY this application's parameters, and only decrypt them.
cat > /tmp/ec2-params.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "ssm:GetParameter",
    "Resource": "arn:aws:ssm:${AWS_REGION}:${ACCOUNT_ID}:parameter/baseplate/*"
  }]
}
JSON

aws iam put-role-policy \
  --role-name BaseplateInstanceRole \
  --policy-name BaseplateReadOwnParameters \
  --policy-document file:///tmp/ec2-params.json

# Attach it to the instance.
aws iam create-instance-profile --instance-profile-name BaseplateInstanceProfile
aws iam add-role-to-instance-profile \
  --instance-profile-name BaseplateInstanceProfile \
  --role-name BaseplateInstanceRole

aws ec2 associate-iam-instance-profile \
  --instance-id "$INSTANCE_ID" \
  --iam-instance-profile Name=BaseplateInstanceProfile
```

Confirm the agent has registered — this must list your instance before
CD can reach it:

```bash
aws ssm describe-instance-information \
  --query "InstanceInformationList[].{Id:InstanceId,Ping:PingStatus,Agent:AgentVersion}" \
  --output table
```

`PingStatus: Online` is the green light. It can take a minute after
attaching the profile.

---

## 7. Store the GHCR pull token

Skip this section entirely if your packages are public — the deploy
script detects the missing parameter and pulls anonymously.

For private packages, create a GitHub personal access token (classic)
with **`read:packages` only**, then:

```bash
aws ssm put-parameter \
  --name /baseplate/ghcr-token \
  --type SecureString \
  --value 'ghp_xxxxxxxxxxxxxxxxxxxx' \
  --description 'Read-only GHCR token for pulling baseplate images'
```

The instance reads it with its own role at deploy time. It is
deliberately **not** passed through the SSM command document: command
parameters are recorded in CloudTrail, and a registry credential in an
audit log is a credential in an audit log.

---

## 8. Wire up GitHub

Create the environment first — the trust policy's `sub` condition
requires the job to run in it, so a missing environment shows up as an
STS `AccessDenied`, not as a GitHub error.

**Settings → Environments → New environment → `production`**

Then add, **scoped to that environment**:

| Kind | Name | Example | Notes |
| --- | --- | --- | --- |
| Secret | `AWS_ROLE_ARN` | `arn:aws:iam::123456789012:role/BaseplateGithubDeployRole` | Contains your account id. |
| Variable | `AWS_REGION` | `ap-southeast-1` | |
| Variable | `EC2_INSTANCE_ID` | `i-0123456789abcdef0` | |
| Variable | `PUBLIC_URL` | `https://demo.example.com` | No trailing slash. CD polls `${PUBLIC_URL}/api/ready` and shows it as the deployment URL. Leave unset to skip the external check. |
| Variable | `DEPLOY_DIR` | `/opt/baseplate` | Optional; this is the default. |

There is nothing else to configure. In particular there is **no**
`AWS_ACCESS_KEY_ID`, **no** `AWS_SECRET_ACCESS_KEY` and **no**
`DEPLOY_SSH_KEY`. If those exist in the repository from an earlier
setup, delete them — an unused credential is still a credential.

Optionally add yourself as a **required reviewer** on the `production`
environment. CD will then pause before `deploy-ec2` until someone
approves.

---

## 9. First deploy

```bash
git push origin main
```

Then watch, in order:

1. **`ci`** — the quality gates, then `image-api` / `image-web`
   (build + scan + push) and `image-promote`. The `image-promote` job's
   summary prints the tag CD will deploy.
2. **`cd`** — `gate` → `verify-images` → `deploy-ec2`.

The `deploy-ec2` job prints the remote `stdout` and `stderr` verbatim,
so `scripts/deploy.sh`'s own progress is in the Actions log:

```
==> deploying tag 'sha-abc1234'
==> pulling images
==> starting services
==> waiting for containers to report healthy
==> applying migrations
==> polling http://localhost:8080/api/ready
==> healthy after 3 attempt(s)
```

Confirm from outside:

```bash
curl -fsS https://your-domain.example/api/ready
```

### The very first deploy is the one that can surprise you

The database is empty and the `pgdata` volume does not exist yet. The
sequence handles it — `db` comes up, the healthcheck passes, then the
`migrate` job applies every migration from scratch — but it is slower
than a steady-state deploy and the `wait-for-healthy` step does most of
the waiting. Give it up to three minutes before assuming it hung.

---

## 10. Rollback

Rollback is a deploy of the previous tag. Nothing else changes.

**Actions → cd → Run workflow**, and set `tag` to the previous
`sha-<short>`:

```
tag: sha-9f2c1ab
```

To find it: **Actions → cd →** the last good run **→** the summary table
shows the deployed tag. Or from the host:

```bash
aws ssm start-session --target "$INSTANCE_ID"
sudo docker ps --format '{{.Image}}'
```

`workflow_dispatch` bypasses the CI gate by design — it is the
break-glass path, and during an incident the thing you want to deploy is
a commit whose CI already passed hours ago.

The `latest` tag is never used for a rollback. It has moved.

---

## 11. Troubleshooting

### `Error: Not authorized to perform sts:AssumeRoleWithWebIdentity`

The trust policy's `sub` does not match the token. Print what GitHub
actually sent by adding a debug step to the job:

```yaml
- run: echo "${{ toJSON(github) }}" | jq '{repository, ref, workflow}'
```

The three usual causes, in order of likelihood:

1. The job does not declare `environment: production`, or the
   environment does not exist. The `sub` is then
   `repo:<owner>/<repo>:ref:refs/heads/main` and does not match.
2. Owner or repository name is misspelled — the `sub` is
   case-sensitive.
3. The OIDC provider does not exist in this account, or was created in a
   different one.

### `Error: Credentials could not be loaded`

The job is missing `permissions: id-token: write`. Without it GitHub
does not mint a token at all.

### `InvalidInstanceId` on `SendCommand`

The SSM agent has not registered. Check:

```bash
aws ssm describe-instance-information --output table
```

If the instance is absent: the instance profile is not attached
(step 6), or the instance has no outbound 443, or the agent is stopped
(`sudo systemctl status amazon-ssm-agent`).

### The SSM command status is `Failed`

The remote `stdout`/`stderr` is printed in the job log. Work down it:

- `unauthorized` / `denied` on a pull → the GHCR token is missing,
  expired, or lacks `read:packages`. Re-run step 7.
- `no such file or directory: scripts/deploy.sh` → `/opt/baseplate` is
  not a checkout of this repository, or `DEPLOY_DIR` points elsewhere.
- `.env not found` → step 3's environment file was not created.
- `/ready did not return 200 within the timeout` → the deploy ran but
  the app is unhealthy. This is a **release** problem, not a pipeline
  problem: go to [runbook.md → Common failures](runbook.md#common-failures).

### `verify-images` fails with `MISSING`

CD does not build images ([ADR-0009](adr/0009-images-built-once-in-ci.md)).
The tag it wants was never published. Check the `ci` run for that SHA:
`image-promote` is the job that guarantees all three tags exist, and it
is skipped on pull requests and on a red CI.

### The deploy succeeded but the site is unreachable from a browser

The pipeline's own `/ready` poll runs on the host (`localhost`), so it
passes even when nothing outside can reach the box. Check, in order: the
security group's inbound rule on `WEB_PORT`, that the instance has a
public IP or is behind a load balancer that does, and `CORS_ORIGINS` in
`/opt/baseplate/.env` — a wrong origin gives a *loading* page whose API
calls all fail.

---

## 12. Teardown

```bash
aws ec2 terminate-instances --instance-ids "$INSTANCE_ID"

aws iam delete-role-policy --role-name BaseplateGithubDeployRole --policy-name BaseplateDeploy
aws iam delete-role       --role-name BaseplateGithubDeployRole

aws iam remove-role-from-instance-profile \
  --instance-profile-name BaseplateInstanceProfile --role-name BaseplateInstanceRole
aws iam delete-instance-profile --instance-profile-name BaseplateInstanceProfile
aws iam delete-role-policy --role-name BaseplateInstanceRole --policy-name BaseplateReadOwnParameters
aws iam detach-role-policy --role-name BaseplateInstanceRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam delete-role --role-name BaseplateInstanceRole

aws ssm delete-parameter --name /baseplate/ghcr-token
```

Leave the OIDC provider — it is account-wide and other repositories may
be using it.

Terminating the instance destroys the `pgdata` volume with it. There is
no automated backup ([runbook.md](runbook.md#5-docker-compose-down-lost-data)).
Dump the database first if the data matters:

```bash
aws ssm start-session --target "$INSTANCE_ID"
sudo docker compose -p baseplate-prod -f /opt/baseplate/docker/compose.prod.yaml \
  --env-file /opt/baseplate/.env exec -T db \
  pg_dump -U baseplate baseplate > /tmp/baseplate-$(date +%F).sql
```

---

## Related

- [ADR-0010 — OIDC + SSM deploy](adr/0010-oidc-ssm-deploy-to-ec2.md) — why this transport
- [ADR-0009 — images built once in CI](adr/0009-images-built-once-in-ci.md) — why CD does not build
- [ADR-0008 — CI gates CD](adr/0008-ci-gates-cd.md) — why CD does not run on push
- [ADR-0003 — single deploy environment](adr/0003-single-deploy-environment.md) — why there is one instance
- [ci-cd.md](ci-cd.md) — the pipeline itself
- [runbook.md](runbook.md) — operating it once it is live
