# ADR 0010 — Deploy to EC2 via GitHub OIDC and SSM Run Command

## Context

The deploy target is a single AWS EC2 instance [ADR-0003]. The previous
`cd.yml` reached it with `appleboy/ssh-action` and three repository
secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`.

That transport has three standing costs:

1. **A long-lived private key lives in GitHub.** It is valid until
   somebody remembers to rotate it, it grants shell on production, and
   any workflow in the repository that can read `secrets` can use it.
   There is no expiry and no per-deploy audit identity.
2. **Port 22 must be reachable from GitHub's runners.** GitHub publishes
   the runner ranges, but they are large and they change. In practice
   the security group ends up with `0.0.0.0/0` on 22 and the box is
   exposed to the internet's background SSH scan traffic permanently, to
   support a connection that happens a few times a day.
3. **The host needs a user, and that user needs `docker` rights.** One
   more thing to provision, and one more thing to get wrong.

## Decision

CD authenticates to AWS with **GitHub's OIDC provider** and executes the
deploy with **SSM Run Command**.

```
GitHub job  --OIDC token-->  AWS STS  --1h creds-->  ssm:SendCommand
                                                          |
                                       SSM agent polls outbound, executes
                                                          |
                                                  EC2: scripts/deploy.sh
```

- `permissions: id-token: write` on the deploy job only. GitHub mints a
  signed JWT describing the repository, ref and workflow.
- `aws-actions/configure-aws-credentials` exchanges it for STS
  credentials via a role whose **trust policy** names this repository and
  restricts `sub` to `repo:<owner>/<repo>:environment:production`. No
  other repository, and no other environment, can assume it.
- The role's permission policy allows `ssm:SendCommand` **only** against
  the one instance ARN and the `AWS-RunShellScript` document, plus the
  two read calls needed to collect the result.
- The instance's own role reads the GHCR pull token out of SSM Parameter
  Store. The registry credential never transits the command document,
  which is recorded in CloudTrail.

The remote command runs `scripts/deploy.sh --pull` — the same script the
runbook points a human at. One deploy sequence, whether a pipeline or a
person runs it.

The SSH job stays in `cd.yml` as a commented block: it is the
break-glass transport for the one case the primary path cannot recover
from itself, an unreachable SSM agent.

## Consequences

- **No standing credential exists.** There is no AWS access key and no
  SSH private key in the repository. The deploy credential is minted per
  run and expires in 30 minutes.
- **The instance needs no inbound rule for deploys.** The SSM agent
  polls outbound over 443. The security group's only ingress is the web
  port (or the load balancer in front of it). Port 22 can be closed
  entirely.
- **Every deploy is attributable.** CloudTrail records
  `AssumeRoleWithWebIdentity` with the session name
  `gha-cd-<run_id>`, and `SendCommand` with the resolved image tag in
  the comment. "Who deployed this, from which run" is a CloudTrail
  query, not a guess.
- **The blast radius of a compromised workflow is one API call.** The
  role cannot start instances, read S3, or touch IAM. It can send one
  document to one instance.
- **A new dependency: the SSM agent.** It ships and runs by default on
  Amazon Linux 2023 and current Ubuntu AMIs, but it is a component that
  can be broken, and when it is, the deploy path is down even though the
  application is fine. The commented SSH job is the answer.
- **Setup is longer than "paste an SSH key".** Two IAM roles, a trust
  policy and an OIDC provider. It is a one-time cost, and
  `docs/deploy-aws-ec2.md` is the copy-pasteable version of it.

## Alternatives rejected

- **Keep SSH, but source the key from a secrets manager.** Moves the
  key; does not remove it. Port 22 stays open.
- **OIDC + SSH via EC2 Instance Connect.** Removes the stored key
  (short-lived keys pushed at connect time) but still needs port 22 open
  to the EC2 Instance Connect service range, and adds a second AWS
  service to the path. SSM does the same job with no ingress.
- **Push to ECR and use CodeDeploy / ECS.** A larger, better answer for
  a fleet. For one instance running `docker compose`, it replaces a
  30-line job with a deployment group, an appspec, and an agent — and it
  would mean maintaining a second registry alongside GHCR, which
  [ADR-0009] made the single source of images.
- **A pull-based agent on the host (Watchtower, Keel).** Inverts the
  control: the host decides when to deploy. Rollback and "did the deploy
  succeed" both become asynchronous and unobservable from the pipeline,
  and the `/ready` gate that fails a bad release disappears.
