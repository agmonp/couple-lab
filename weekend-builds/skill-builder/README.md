# Auto-Skill Builder

**Your chat corrections, promoted to permanent skills.**

Every "no, we use pnpm", "commit messages in English", "errors are snake_case"
you type at an AI assistant dies with the chat. This tool mines a transcript
for durable corrections and packages them as installable
[Claude Code skills](https://code.claude.com/docs) (`SKILL.md` folders).

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...

python3 skill_builder.py transcript.txt            # → ./skills/<name>/SKILL.md (review first)
python3 skill_builder.py transcript.txt --install  # → ~/.claude/skills/
```

A transcript is any text export of a conversation — a Claude Code session,
a claude.ai copy-paste, even a Slack thread.

Based on the *Auto-Skill Builder* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds).

## How it works

Claude reads the transcript with one job: find corrections that will still be
true **next session** (conventions, preferences, repeated fixes), group the
related ones, and return them through **structured outputs** as
`{name, description, instructions, evidence}` — so the output always parses
and each skill records the exact quote it came from. One-off task details are
explicitly excluded, and an empty list is a valid answer.

Each skill becomes:

```
skills/commit-style/SKILL.md
---
name: commit-style
description: Use when writing commit messages in this repo.
---
Write commit messages in English, imperative mood...
<!-- extracted from: "no — commit messages always in English please" -->
```

## Make it yours

- Point it at your shell history of `claude` sessions weekly (cron) and
  review the diff of `skills/`.
- Tighten the extraction bar by editing `SYSTEM` ("only corrections made
  twice or more").
