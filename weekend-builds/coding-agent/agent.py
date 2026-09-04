#!/usr/bin/env python3
"""Autonomous Coding Agent — give it a task and a repo, it writes the fix.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 agent.py "the CLI crashes on empty input, add a test and fix it" --repo ~/code/mytool
    python3 agent.py --issue issue.md --repo ~/code/mytool

The agent explores the repo, edits files, and runs commands (tests!) in a
loop until the task is done — powered by the SDK's tool runner, so the
agentic loop itself is ~10 lines.

⚠️  The agent executes shell commands inside --repo. Run it on a repo with a
clean git state (it prints the diff at the end) and read the transcript.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import anthropic
from anthropic import beta_tool
from anthropic.lib.tools import ToolError

MODEL = "claude-opus-4-8"
MAX_ITERATIONS = 40

REPO = Path.cwd()  # set for real in main()


def _safe(path: str) -> Path:
    """Confine file operations to the repo."""
    resolved = (REPO / path).resolve()
    if not resolved.is_relative_to(REPO.resolve()):
        raise ToolError(f"path escapes the repo: {path}")
    return resolved


@beta_tool
def bash(command: str) -> str:
    """Run a shell command inside the repository (cwd = repo root).
    Use it to explore (ls, grep), run tests, and verify your changes.

    Args:
        command: The shell command to run.
    """
    print(f"  $ {command}")
    try:
        result = subprocess.run(command, shell=True, cwd=REPO, timeout=180,
                                capture_output=True, text=True)
    except subprocess.TimeoutExpired:
        return "ERROR: command timed out after 180s"
    output = (result.stdout + result.stderr).strip()
    return f"exit code {result.returncode}\n{output[-8000:]}" if output \
        else f"exit code {result.returncode} (no output)"


@beta_tool
def read_file(path: str) -> str:
    """Read a file from the repository.

    Args:
        path: Path relative to the repo root.
    """
    print(f"  read {path}")
    target = _safe(path)
    if not target.is_file():
        return f"ERROR: {path} does not exist"
    text = target.read_text(encoding="utf-8", errors="replace")
    return text[:40000] + ("\n...[truncated]" if len(text) > 40000 else "")


@beta_tool
def write_file(path: str, content: str) -> str:
    """Create or overwrite a file in the repository.

    Args:
        path: Path relative to the repo root.
        content: The complete new file content.
    """
    print(f"  write {path} ({len(content)} chars)")
    target = _safe(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"wrote {path}"


SYSTEM = """You are an autonomous coding agent working on the user's repository.

Method:
1. Explore first — read the relevant files and understand how things work
   before changing anything. Match the project's existing style.
2. Make the smallest change that solves the task. No drive-by refactors.
3. Verify: run the project's tests (or write one that reproduces the bug
   first, then fix until it passes).
4. Finish with a short summary: what you changed, how you verified it,
   and anything the user should review.

If the task is impossible or the repo contradicts it, stop and explain
instead of forcing a change."""


def main() -> None:
    global REPO
    parser = argparse.ArgumentParser(description="Autonomous coding agent.")
    parser.add_argument("task", nargs="?", help="What to do")
    parser.add_argument("--issue", type=Path, help="Read the task from a file (e.g. issue.md)")
    parser.add_argument("--repo", type=Path, default=Path.cwd(), help="Repository to work in")
    args = parser.parse_args()

    REPO = args.repo.expanduser().resolve()
    if not REPO.is_dir():
        sys.exit(f"No such directory: {REPO}")
    task = args.issue.read_text(encoding="utf-8") if args.issue else args.task
    if not task:
        sys.exit("Give a task, or --issue file.md")

    client = anthropic.Anthropic()
    print(f"Repo: {REPO}\nTask: {task[:200]}\n{'=' * 60}")
    runner = client.beta.messages.tool_runner(
        model=MODEL,
        max_tokens=32000,
        thinking={"type": "adaptive"},
        system=SYSTEM,
        tools=[bash, read_file, write_file],
        messages=[{"role": "user", "content": task}],
        max_iterations=MAX_ITERATIONS,
    )
    try:
        for message in runner:
            for block in message.content:
                if block.type == "text" and block.text.strip():
                    print(f"\n{block.text.strip()}\n")
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")

    print(f"{'=' * 60}\nDone. Review the changes:")
    subprocess.run("git diff --stat", shell=True, cwd=REPO)


if __name__ == "__main__":
    main()
