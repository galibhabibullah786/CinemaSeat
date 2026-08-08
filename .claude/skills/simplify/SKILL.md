---
name: simplify
description: Review changed code for reuse, quality, and efficiency, then fix any issues found. Invoke after a non-trivial change lands in the working tree and before commit.
---

# Simplify

Use when the change is non-trivial and you want to catch reuse,
quality, and efficiency regressions that the first pass missed. Cheap
to run; cheap to skip; expensive to skip and find out in `main`.

Full skill body lives in **`.agents/skills/simplify.md`**.
