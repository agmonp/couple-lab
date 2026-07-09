#!/usr/bin/env python3
"""Auto-Skill Builder — turn chat corrections into installable skill files.

Every time you correct your AI assistant ("no, we use pnpm not npm",
"always write commit messages in English", "our API errors are snake_case"),
that knowledge evaporates when the chat ends. This tool mines a transcript
for those corrections and packages them as Claude Code skills.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 skill_builder.py transcript.txt
    python3 skill_builder.py transcript.md --install   # write into ~/.claude/skills/

Transcript = any text export of a conversation (Claude Code session,
claude.ai copy-paste, Slack thread...).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import anthropic

MODEL = "claude-opus-4-8"

SKILLS_SCHEMA = {
    "type": "object",
    "properties": {
        "skills": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string",
                             "description": "kebab-case skill name, e.g. commit-style"},
                    "description": {"type": "string",
                                    "description": ("One sentence: when this skill applies. "
                                                    "Starts with 'Use when...'")},
                    "instructions": {"type": "string",
                                     "description": ("Markdown body: the durable rules "
                                                     "extracted from the corrections, written "
                                                     "as direct instructions with examples "
                                                     "from the transcript.")},
                    "evidence": {"type": "string",
                                 "description": "Short quote(s) of the correction(s) this came from"},
                },
                "required": ["name", "description", "instructions", "evidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["skills"],
    "additionalProperties": False,
}

SYSTEM = """You mine chat transcripts for durable, reusable corrections the user made
to an AI assistant — preferences, project conventions, repeated fixes.

Extract ONLY corrections that will apply to future sessions (not one-off task
details). Group related corrections into one skill. If there are no durable
corrections, return an empty list. Write instructions in the transcript's
language, in imperative form, concrete enough that an assistant reading only
the skill would behave correctly."""


def extract_skills(transcript: str) -> list[dict]:
    client = anthropic.Anthropic()
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            system=SYSTEM,
            messages=[{"role": "user",
                       "content": f"Transcript:\n\n{transcript[:150000]}"}],
            output_config={"format": {"type": "json_schema", "schema": SKILLS_SCHEMA}},
        )
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")
    data = json.loads("".join(b.text for b in response.content if b.type == "text"))
    return data["skills"]


def write_skill(skill: dict, root: Path) -> Path:
    name = re.sub(r"[^a-z0-9-]", "-", skill["name"].lower()).strip("-") or "skill"
    folder = root / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "SKILL.md").write_text(
        f"""---
name: {name}
description: {skill['description']}
---

{skill['instructions']}

<!-- extracted from: {skill['evidence']} -->
""",
        encoding="utf-8",
    )
    return folder / "SKILL.md"


def main() -> None:
    parser = argparse.ArgumentParser(description="Chat transcript → skill files.")
    parser.add_argument("transcript", type=Path)
    parser.add_argument("--install", action="store_true",
                        help="Write into ~/.claude/skills/ instead of ./skills/")
    args = parser.parse_args()

    if not args.transcript.is_file():
        sys.exit(f"No such file: {args.transcript}")
    print(f"Mining {args.transcript.name} for durable corrections...")
    skills = extract_skills(args.transcript.read_text(encoding="utf-8", errors="replace"))

    if not skills:
        print("No durable corrections found — nothing worth a skill in this transcript.")
        return

    root = Path.home() / ".claude" / "skills" if args.install else Path("skills")
    for skill in skills:
        path = write_skill(skill, root)
        print(f"\n● {skill['name']}")
        print(f"  {skill['description']}")
        print(f"  evidence: {skill['evidence'][:100]}")
        print(f"  → {path}")
    print(f"\n{len(skills)} skill(s) written to {root}/")
    if not args.install:
        print("Review them, then rerun with --install (or copy to ~/.claude/skills/).")


if __name__ == "__main__":
    main()
