---
name: update-config
description: Configure the puku-cli harness via .claude/settings.json. Load when the user asks for automated behaviour that fires on every/most invocations — "from now on", "each time", "whenever", "before/after every" — because the harness executes hooks, not the LLM.
---

# Update Config

Use when the user expresses an automated behaviour that needs to
survive across sessions. Trigger phrases: "from now on", "each
time", "whenever", "before/after every". The harness executes
hooks; the LLM forgets.

Full skill body lives in **`.agents/skills/update-config.md`**.
