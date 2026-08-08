# Create Skill

**Trigger:** the user asks to create a skill, save a workflow as a
skill, capture a process as a reusable command, or automate something
they keep doing. Typical phrases:

- "create a skill for X"
- "save this as a skill"
- "make a reusable command from this"
- "automate the X workflow"
- "/create-skill"

The trigger phrase pattern is intentional: do not pre-create skills
"because they might be useful". Skills exist when there is a real
recurring workflow, not when the author is being thorough.

## When NOT to use this skill

- The workflow has been used once. A skill is a recurring pattern;
  one-shot workflows go in `docs/` or `scripts/`.
- The workflow is just "explain how X works". That is documentation,
  not a skill.
- The workflow is a one-line operation the user can type faster than
  they can invoke a skill.
- The workflow is a primitive (file edit, bash command, web fetch).
  Skills compose primitives; they do not replace them.

## Where skills live

This repo has two parallel layouts and both are required:

```
.agents/skills/<name>.md           # canonical body
.claude/skills/<name>/SKILL.md     # Claude frontmatter wrapper
```

The `.agents/skills/<name>.md` is the source of truth — it is the
content other agent systems read. The `.claude/skills/<name>/SKILL.md`
is a thin frontmatter wrapper that tells Claude when to load the
skill; it points at the `.agents/skills/` file as the body.

Drift between the two is the failure mode. The `.claude/` wrapper
should not duplicate content; it should describe the trigger and
link to the canonical body.

## Frontmatter format

```yaml
---
name: <kebab-case-name>
description: <one-line trigger description; loaded by Claude to decide when to invoke>
---
```

`name` is the skill identifier — kebab-case, matches the directory
name.

`description` is the most important field. Claude loads skills based
on the description alone. The description should:

- Start with "Load when ..." or "Use to ..." or "Review ..." — a verb
  the model can pattern-match on.
- Mention the specific trigger phrases the user would say.
- Name the failure mode the skill prevents, when applicable.
- Stay under ~25 words; longer descriptions get cut.

## Authoring the body

A good skill body has:

1. **Trigger** — when to load this skill. Concrete, not aspirational.
2. **When NOT to use it** — over-application is the failure mode.
3. **Steps** — short, imperative, in order. Numbered, not nested.
4. **Failure modes** — the specific ways the workflow goes wrong, and
   what to do instead.
5. **Examples** — at least one concrete before/after or input/output
   pair, if the skill has a non-obvious shape.

Bad skill bodies are walls of prose. The reader is an LLM that will
act on the prose; terse, structured bodies act better than narrative.

## Validation checklist

Before declaring the skill done:

- [ ] Body file exists at `.agents/skills/<name>.md`.
- [ ] Wrapper file exists at `.claude/skills/<name>/SKILL.md` with
      valid frontmatter (`name`, `description`).
- [ ] `description` is one line, mentions the trigger, names the
      failure mode if there is one.
- [ ] Body opens with a "Trigger:" block listing the trigger phrases.
- [ ] Body has a "When NOT to use this skill" section, or an inline
      note that the skill is universally applicable.
- [ ] Steps are imperative and numbered.
- [ ] At least one concrete example.
- [ ] No duplicated content between wrapper and body; the wrapper
      references the body, it does not restate it.

## Failure modes

- **Two skills covering the same workflow.** Pick one; either rename
  or merge. Drift between near-identical skills is worse than missing
  one.
- **Skill without a trigger.** If you cannot write the trigger
  description in one line, the workflow is not yet specific enough to
  be a skill.
- **Skill that just restates a tool's docs.** The skill should encode
  a habit, not be a manual. If the user can read the docs faster than
  they can invoke the skill, the skill is dead weight.
