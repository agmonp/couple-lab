#!/usr/bin/env python3
"""Multi-Agent Research Crew — a team of agents that research, analyze,
and write together.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 crew.py "should a small startup adopt passkeys in 2026?"

Pipeline (each agent is a separate Claude conversation with its own role):

    Researcher  — gathers facts with web search, produces sourced notes
    Analyst     — stress-tests the notes: gaps, biases, counterarguments
    Writer      — turns notes + critique into the final report

The full crew transcript is saved to output/<slug>/ so you can inspect what
each agent contributed.
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

import anthropic

MODEL = "claude-opus-4-8"
OUTPUT_DIR = Path(__file__).parent / "output"

AGENTS = {
    "researcher": """You are the crew's RESEARCHER.
Gather concrete, current facts on the topic using web search. Produce research
notes: bullet points with numbers, dates, names — each with its source URL.
Cover at least two viewpoints. Notes only, no polished prose.""",
    "analyst": """You are the crew's ANALYST.
You receive research notes. Stress-test them: What's missing? Which claims are
weak or single-sourced? What would a skeptic say? What follow-up matters most?
Output: a numbered critique + a short list of the strongest validated points.""",
    "writer": """You are the crew's WRITER.
You receive research notes and an analyst's critique. Write the final report:
an executive summary, findings (respecting the critique — flag weak claims as
such), a clear recommendation, and a Sources section. Write in the same
language as the original topic.""",
}


def run_agent(client: anthropic.Anthropic, role: str, prompt: str,
              tools: list | None = None) -> str:
    print(f"\n{'=' * 60}\n### {role.upper()} working...\n")
    kwargs = {"tools": tools} if tools else {}
    with client.messages.stream(
        model=MODEL,
        max_tokens=32000,
        thinking={"type": "adaptive"},
        system=AGENTS[role],
        messages=[{"role": "user", "content": prompt}],
        **kwargs,
    ) as stream:
        for text in stream.text_stream:
            print(text, end="", flush=True)
        message = stream.get_final_message()

    # Server-side tools may pause long turns; resume until done.
    while message.stop_reason == "pause_turn":
        with client.messages.stream(
            model=MODEL, max_tokens=32000, thinking={"type": "adaptive"},
            system=AGENTS[role],
            messages=[{"role": "user", "content": prompt},
                      {"role": "assistant", "content": message.content}],
            **kwargs,
        ) as stream:
            for text in stream.text_stream:
                print(text, end="", flush=True)
            message = stream.get_final_message()
    print()
    return "".join(b.text for b in message.content if b.type == "text")


def main() -> None:
    parser = argparse.ArgumentParser(description="Research crew: topic → report.")
    parser.add_argument("topic")
    parser.add_argument("--max-searches", type=int, default=8)
    args = parser.parse_args()

    client = anthropic.Anthropic()
    search_tools = [{"type": "web_search_20260209", "name": "web_search",
                     "max_uses": args.max_searches}]

    try:
        notes = run_agent(client, "researcher",
                          f"Topic: {args.topic}\n\nProduce the research notes.",
                          tools=search_tools)
        critique = run_agent(client, "analyst",
                             f"Topic: {args.topic}\n\nResearch notes:\n\n{notes}")
        report = run_agent(client, "writer",
                           f"Topic: {args.topic}\n\nResearch notes:\n\n{notes}\n\n"
                           f"Analyst critique:\n\n{critique}")
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")

    slug = re.sub(r"[^a-z0-9]+", "-", args.topic.lower()).strip("-")[:50] or "report"
    run_dir = OUTPUT_DIR / f"{date.today()}-{slug}"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "1-research-notes.md").write_text(notes, encoding="utf-8")
    (run_dir / "2-analyst-critique.md").write_text(critique, encoding="utf-8")
    (run_dir / "3-final-report.md").write_text(report, encoding="utf-8")
    print(f"\n{'=' * 60}\nCrew transcript saved to {run_dir}/")


if __name__ == "__main__":
    main()
