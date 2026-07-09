#!/usr/bin/env python3
"""One-Command Web Researcher — type a topic, get a research report.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 research.py "state of solid-state batteries 2026"
    python3 research.py "https://example.com/article" --questions "who, what, main risks"

Uses Claude's server-side web_search + web_fetch tools — no scraping code,
no search-API key. The report is streamed to the terminal and saved as
reports/<slug>.md with a source list.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

import anthropic

MODEL = "claude-opus-4-8"
REPORTS_DIR = Path(__file__).parent / "reports"

SYSTEM = """You are a meticulous research assistant.
Research the given topic using web search and web fetch, then write a report with:

1. A 3-5 sentence executive summary
2. Key findings, grouped under clear headings
3. Disagreements or open questions you noticed between sources
4. A "Sources" section listing every URL you actually used

Be concrete — numbers, dates, names. Distinguish established facts from claims.
Write the report in the same language as the topic prompt."""


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:60] or "report"


def main() -> None:
    parser = argparse.ArgumentParser(description="Topic or URL → research report.")
    parser.add_argument("topic", help="A topic to research, or a URL to analyze")
    parser.add_argument("--questions", help="Specific questions the report must answer")
    parser.add_argument("--max-searches", type=int, default=8,
                        help="Cap on web searches (default 8)")
    args = parser.parse_args()

    prompt = f"Research this and write the report: {args.topic}"
    if args.topic.startswith(("http://", "https://")):
        prompt = (f"Fetch and analyze this page, follow up with searches for missing "
                  f"context, then write the report: {args.topic}")
    if args.questions:
        prompt += f"\n\nThe report must answer these questions: {args.questions}"

    client = anthropic.Anthropic()
    print(f"Researching: {args.topic}\n{'=' * 60}\n")
    try:
        with client.messages.stream(
            model=MODEL,
            max_tokens=64000,
            thinking={"type": "adaptive"},
            system=SYSTEM,
            tools=[
                {"type": "web_search_20260209", "name": "web_search",
                 "max_uses": args.max_searches},
                {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 12},
            ],
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                print(text, end="", flush=True)
            message = stream.get_final_message()

        # Server tools can pause long turns — resume until the report is done.
        while message.stop_reason == "pause_turn":
            with client.messages.stream(
                model=MODEL, max_tokens=64000, thinking={"type": "adaptive"},
                system=SYSTEM,
                tools=[
                    {"type": "web_search_20260209", "name": "web_search",
                     "max_uses": args.max_searches},
                    {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 12},
                ],
                messages=[
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": message.content},
                ],
            ) as stream:
                for text in stream.text_stream:
                    print(text, end="", flush=True)
                message = stream.get_final_message()
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")

    report = "".join(b.text for b in message.content if b.type == "text")
    REPORTS_DIR.mkdir(exist_ok=True)
    out = REPORTS_DIR / f"{date.today()}-{slugify(args.topic)}.md"
    out.write_text(f"# Research: {args.topic}\n\n*{date.today()}*\n\n{report}\n",
                   encoding="utf-8")
    searches = sum(1 for b in message.content if b.type == "server_tool_use")
    print(f"\n\n{'=' * 60}\nSaved to {out} ({searches} tool calls this turn)")


if __name__ == "__main__":
    main()
