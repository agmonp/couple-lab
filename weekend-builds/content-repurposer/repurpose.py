#!/usr/bin/env python3
"""Content Repurposer — one piece of content, every platform, your voice.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 repurpose.py post.md
    python3 repurpose.py post.md --platforms twitter,linkedin
    python3 repurpose.py post.md --voice samples/   # imitate your published writing

Two-step prompt chain:
  1. Distill — extract the core ideas, arguments, and voice fingerprint.
  2. Transform — rewrite per platform from the distillation (not the raw text),
     which keeps versions consistent with each other and with your voice.

Outputs land in out/<platform>.md.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import anthropic

MODEL = "claude-opus-4-8"

PLATFORMS = {
    "twitter": """A thread of 4-8 tweets. First tweet must hook without clickbait.
One idea per tweet, ≤280 chars each, numbered (1/, 2/ ...). No hashtag spam
(max 1-2 total). End with the single strongest takeaway.""",
    "linkedin": """A LinkedIn post: strong first two lines (they show before "...see more"),
short paragraphs, a concrete story or number early, one clear takeaway,
a question to invite comments. No emoji walls, max ~1300 chars.""",
    "newsletter": """A newsletter section: personal opening line, the ideas with a bit more
depth and one added example, subheadings if useful, a P.S. with a related link
placeholder. Warm but efficient.""",
    "instagram": """An Instagram caption: strong first line, line breaks for rhythm,
concrete and visual language, 3-5 relevant hashtags at the end,
plus a one-line suggestion for the visual to pair it with.""",
    "youtube": """A YouTube Short / Reel script (≤60s spoken): HOOK (first 3s),
3 beats, punchy spoken-language sentences, [visual cues in brackets],
end with a reason to follow.""",
}

DISTILL_SYSTEM = """Distill the given content. Produce:
1. CORE CLAIMS — every distinct idea/argument, one bullet each
2. EVIDENCE — the facts, numbers, examples used
3. VOICE FINGERPRINT — 5 concrete observations about the author's style
   (sentence rhythm, vocabulary, humor, person, quirks)
Nothing else. This distillation is the source for all rewrites."""

TRANSFORM_SYSTEM = """You rewrite distilled content for a specific platform while preserving the
author's voice. Follow the VOICE FINGERPRINT strictly — the result must sound
like the same person, not like generic social media copy. Never invent facts
that aren't in the distillation. Write in the content's original language.
Output only the final content, no commentary."""


def ask(client: anthropic.Anthropic, system: str, prompt: str) -> str:
    try:
        with client.messages.stream(
            model=MODEL, max_tokens=8192, thinking={"type": "adaptive"},
            system=system, messages=[{"role": "user", "content": prompt}],
        ) as stream:
            message = stream.get_final_message()
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")
    return "".join(b.text for b in message.content if b.type == "text")


def main() -> None:
    parser = argparse.ArgumentParser(description="One post → platform-native versions.")
    parser.add_argument("content", type=Path, help="The source post (.md / .txt)")
    parser.add_argument("--platforms", default="twitter,linkedin,newsletter",
                        help=f"Comma-separated: {', '.join(PLATFORMS)}")
    parser.add_argument("--voice", type=Path,
                        help="Folder of your published writing, to strengthen the voice fingerprint")
    args = parser.parse_args()

    if not args.content.is_file():
        sys.exit(f"No such file: {args.content}")
    targets = [p.strip() for p in args.platforms.split(",")]
    unknown = [p for p in targets if p not in PLATFORMS]
    if unknown:
        sys.exit(f"Unknown platform(s): {unknown}. Available: {list(PLATFORMS)}")

    source = args.content.read_text(encoding="utf-8")
    voice_samples = ""
    if args.voice and args.voice.is_dir():
        samples = [p.read_text(encoding="utf-8", errors="replace")[:4000]
                   for p in sorted(args.voice.glob("*"))[:5] if p.is_file()]
        voice_samples = "\n\n---\n\n".join(samples)

    client = anthropic.Anthropic()

    print("Step 1/2 — distilling core ideas + voice fingerprint...")
    distill_prompt = f"Content:\n\n{source}"
    if voice_samples:
        distill_prompt += ("\n\nAdditional writing samples by the same author "
                           f"(for the voice fingerprint only):\n\n{voice_samples}")
    distillation = ask(client, DISTILL_SYSTEM, distill_prompt)

    out_dir = Path("out")
    out_dir.mkdir(exist_ok=True)
    (out_dir / "_distillation.md").write_text(distillation, encoding="utf-8")

    for platform in targets:
        print(f"Step 2/2 — writing {platform}...")
        result = ask(client, TRANSFORM_SYSTEM,
                     f"Platform rules:\n{PLATFORMS[platform]}\n\n"
                     f"Distillation:\n\n{distillation}")
        (out_dir / f"{platform}.md").write_text(result, encoding="utf-8")
        print(f"  → out/{platform}.md")

    print(f"\nDone. Review out/ — the distillation itself is in out/_distillation.md")


if __name__ == "__main__":
    main()
