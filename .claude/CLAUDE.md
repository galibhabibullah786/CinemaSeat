# Claude Code instructions

The canonical agent instructions for this repository live in
**`.agents/AGENTS.md`**. Read that file first — it defines the workflow,
guard-rails, and the five skills Claude should load on demand
(`correctness-and-concurrency`, `security`, `performance-and-scale`,
`testing`, `observability`).

This file exists only so Claude Code's startup hook can find an
instructions file at the path it expects (`.claude/CLAUDE.md`). Do not
duplicate content here — update `.agents/AGENTS.md` instead.
