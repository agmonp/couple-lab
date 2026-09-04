#!/usr/bin/env python3
"""Decision Simulator — model the futures of a big decision with Monte Carlo.

Describe the decision in a JSON file (see sample-decision.json), then:

    python3 simulate.py sample-decision.json            # fully local, no API
    python3 simulate.py my-decision.json --runs 50000
    python3 simulate.py my-decision.json --ai            # + Claude narrative & assumption critique

Each option has weighted factors with (min, mode, max) estimates — you're
never asked for a single number, only a range. The simulator draws from
triangular distributions 10,000 times and shows the score *distributions*,
not one fake-precise answer.
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
from pathlib import Path

MODEL = "claude-opus-4-8"


def simulate_option(option: dict, runs: int) -> list[float]:
    scores = []
    for _ in range(runs):
        total = 0.0
        for factor in option["factors"]:
            value = random.triangular(factor["min"], factor["max"], factor["mode"])
            total += value * factor["weight"]
        scores.append(total)
    return sorted(scores)


def percentile(sorted_values: list[float], p: float) -> float:
    index = min(int(p / 100 * len(sorted_values)), len(sorted_values) - 1)
    return sorted_values[index]


def histogram(sorted_values: list[float], lo: float, hi: float,
              bins: int = 20, width: int = 34) -> list[str]:
    counts = [0] * bins
    span = (hi - lo) or 1
    for v in sorted_values:
        counts[min(int((v - lo) / span * bins), bins - 1)] += 1
    peak = max(counts) or 1
    lines = []
    for i, c in enumerate(counts):
        left = lo + span * i / bins
        lines.append(f"  {left:>8.1f} | {'█' * round(width * c / peak)}")
    return lines


def run(decision: dict, runs: int) -> dict:
    results = {}
    for option in decision["options"]:
        scores = simulate_option(option, runs)
        results[option["name"]] = scores
    return results


def report(decision: dict, results: dict, runs: int) -> str:
    lines = [f"DECISION: {decision['decision']}",
             f"({runs:,} simulated futures per option; higher score = better)", ""]
    lo = min(s[0] for s in results.values())
    hi = max(s[-1] for s in results.values())
    for name, scores in results.items():
        lines += [f"── {name}",
                  f"   median {percentile(scores, 50):8.1f}   "
                  f"p10 {percentile(scores, 10):8.1f}   p90 {percentile(scores, 90):8.1f}   "
                  f"stdev {statistics.pstdev(scores):6.1f}"]
        lines += histogram(scores, lo, hi)
        lines.append("")

    names = list(results)
    if len(names) == 2:
        a, b = names
        wins = sum(x > y for x, y in zip(
            random.sample(results[a], len(results[a])),
            random.sample(results[b], len(results[b]))))
        lines.append(f"P({a} beats {b}) ≈ {wins / len(results[a]):.0%}")
        # Regret: how bad is the downside you'd accept with each choice
        lines.append(f"Worst realistic case (p10): "
                     f"{a} → {percentile(results[a], 10):.1f}, "
                     f"{b} → {percentile(results[b], 10):.1f}")
    return "\n".join(lines)


def ai_narrative(decision: dict, summary: str) -> None:
    import anthropic

    try:
        client = anthropic.Anthropic()
        with client.messages.stream(
            model=MODEL,
            max_tokens=8192,
            thinking={"type": "adaptive"},
            system="""You help someone interpret a Monte Carlo simulation of a personal decision.
1. Explain what the distributions actually say — in plain language, including
   what the overlap between options means.
2. Interrogate the assumptions: which factor weights or ranges look
   suspicious, and which single estimate, if wrong, would flip the outcome.
3. Suggest what cheap real-world information would most reduce uncertainty.
Do NOT tell them what to choose — sharpen their thinking. Their language.""",
            messages=[{"role": "user", "content":
                       f"Decision model:\n{json.dumps(decision, ensure_ascii=False, indent=1)}"
                       f"\n\nSimulation results:\n{summary}"}],
        ) as stream:
            for text in stream.text_stream:
                print(text, end="", flush=True)
        print()
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")


def validate(decision: dict) -> None:
    for key in ("decision", "options"):
        if key not in decision:
            sys.exit(f"decision file missing '{key}'")
    for option in decision["options"]:
        for factor in option.get("factors", []):
            if not factor["min"] <= factor["mode"] <= factor["max"]:
                sys.exit(f"factor '{factor['name']}' in '{option['name']}': "
                         "needs min <= mode <= max")


def main() -> None:
    parser = argparse.ArgumentParser(description="Monte Carlo for life decisions.")
    parser.add_argument("decision_file", type=Path)
    parser.add_argument("--runs", type=int, default=10000)
    parser.add_argument("--ai", action="store_true", help="Add Claude narrative + critique")
    parser.add_argument("--seed", type=int, help="Reproducible runs")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)
    decision = json.loads(args.decision_file.read_text(encoding="utf-8"))
    validate(decision)
    results = run(decision, args.runs)
    summary = report(decision, results, args.runs)
    print(summary)
    if args.ai:
        print(f"\n{'=' * 60}\n")
        ai_narrative(decision, summary)


if __name__ == "__main__":
    main()
