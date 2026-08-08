# Update Config

**Trigger:** the user asks to configure the puku-cli harness via
`.claude/settings.json`, or expresses an automated behaviour that
needs to fire on every/most invocations:

- "from now on, when X, do Y"
- "each time X, do Y"
- "whenever X happens, Y"
- "before/after every X, do Y"

Trigger phrases are intentional — they map to the harness's hook
mechanism, not to in-conversation behaviour.

## Why this is a separate skill

The harness executes hooks; the LLM does not. An instruction like
"from now on, run `make ci-local` before any commit" only works if
the harness fires `PreToolUse` / `PostToolUse` on the right tool.
Without the hook, the LLM can forget, choose not to, or get
out-of-sync with the user's expectation. The user-facing promise of
"from now on" requires the configuration layer; this skill is the
bridge to it.

## Where the config lives

```
.claude/settings.json
```

The shape:

```json
{
  "hooks": {
    "PreToolUse":  [ { "matcher": "...", "hooks": [ ... ] } ],
    "PostToolUse": [ { "matcher": "...", "hooks": [ ... ] } ],
    "Stop":        [ ... ],
    "SessionStart":[ ... ],
    ...
  }
}
```

Matchers pin a hook to a specific tool (`Bash`, `Edit`, `Write`,
`Read`, etc.). Hooks are arrays of `{type: "command", command: "..."}`
or `{type: "prompt", prompt: "..."}`. Use `command` for deterministic
behaviour (lint, format), `prompt` for judgement calls.

## How to update

1. Read `.claude/settings.json` to see what is already wired. Hooks
   duplicate easily; check before adding.
2. Decide the hook event:
   - `PreToolUse` — before the tool runs. For "always run X before Y".
   - `PostToolUse` — after the tool runs. For "always run X after Y".
   - `Stop` — when the session ends. For "always remind to commit".
   - `SessionStart` — when the session begins. For "always print
     the orientation note".
   - `UserPromptSubmit` — when the user types a message. For "always
     prefix with a reminder".
3. Decide the matcher. Be specific — `Bash` is too broad, `Bash` with
   a `command_matches` regex is right.
4. Write the hook body. Keep it short. Long hooks become
   unmaintainable and the user will disable them.
5. Sanity-check that the hook does not infinite-loop with another
   hook. Hooks firing hooks is the classic config mistake.
6. Update `.agents/AGENTS.md` to document the new automated
   behaviour, so the next agent (human or LLM) sees the same
   expectations the user does.

## Validation checklist

Before declaring the config done:

- [ ] `.claude/settings.json` parses as valid JSON.
- [ ] Each new hook has a non-empty matcher and a non-empty body.
- [ ] No infinite-loop risk: a `PostToolUse` on `Bash` running a
      shell that itself triggers `Bash` is a loop.
- [ ] `.agents/AGENTS.md` mentions the new automated behaviour in
      prose, not only in code.
- [ ] The user can verify by triggering the hook event once and
      seeing the hook fire.

## Failure modes

- **Automating in conversation instead of in config.** "I'll just
  remember to run X before commit" is not a hook. The harness has
  no way to know "remember to run X". Use the config.
- **Over-broad matchers.** `PreToolUse` on every tool runs the hook
  on every operation; that is a performance regression and a noise
  problem. Match narrowly.
- **Hook that calls `claude` recursively.** A `command`-type hook
  cannot spawn another agent. If the workflow needs another agent,
  it is a workflow, not a hook.
- **Hook silently failing.** A `command` hook that returns non-zero
  silently blocks the tool. Either surface the error or wrap the
  command in `|| true` if its failure is non-fatal.
