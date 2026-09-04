#!/usr/bin/env python3
"""Screenshot to Code — photo of a UI → working component.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 screenshot2code.py design.png                 # → Design.tsx (React)
    python3 screenshot2code.py sketch.jpg --format html   # → sketch.html
    python3 screenshot2code.py app.png --notes "dark theme, mobile-first"
"""

from __future__ import annotations

import argparse
import base64
import re
import sys
from pathlib import Path

import anthropic

MODEL = "claude-opus-4-8"

MEDIA_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".gif": "image/gif", ".webp": "image/webp"}

PROMPTS = {
    "react": """Recreate this UI as a single self-contained React component in TypeScript.
Rules:
- One file, default export, no external UI libraries — style with inline Tailwind
  classes if the design suits it, otherwise a <style> block or style objects.
- Match layout, spacing, colors, and typography as closely as the image allows.
- Use realistic placeholder text/data matching what's visible.
- Interactive elements (buttons, inputs, tabs) should have working local state.
Output ONLY the code, inside one ```tsx block.""",
    "html": """Recreate this UI as a single self-contained HTML file (inline CSS, and inline
JS only if the design needs it). Match layout, spacing, colors, and typography
as closely as the image allows; use realistic placeholder content.
Output ONLY the code, inside one ```html block.""",
}


def extract_code(text: str) -> str:
    match = re.search(r"```[a-z]*\n(.*?)```", text, re.S)
    return (match.group(1) if match else text).strip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="UI screenshot → component code.")
    parser.add_argument("image", type=Path)
    parser.add_argument("--format", choices=("react", "html"), default="react")
    parser.add_argument("--notes", help="Extra instructions (theme, framework quirks...)")
    parser.add_argument("--out", type=Path, help="Output file path")
    args = parser.parse_args()

    media_type = MEDIA_TYPES.get(args.image.suffix.lower())
    if not media_type:
        sys.exit(f"Unsupported image type: {args.image.suffix}")
    if not args.image.is_file():
        sys.exit(f"No such file: {args.image}")
    image_b64 = base64.standard_b64encode(args.image.read_bytes()).decode()

    prompt = PROMPTS[args.format]
    if args.notes:
        prompt += f"\n\nAdditional instructions from the user: {args.notes}"

    client = anthropic.Anthropic()
    print(f"Reading {args.image.name} → generating {args.format}...")
    try:
        with client.messages.stream(
            model=MODEL,
            max_tokens=32000,
            thinking={"type": "adaptive"},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image",
                     "source": {"type": "base64", "media_type": media_type,
                                "data": image_b64}},
                    {"type": "text", "text": prompt},
                ],
            }],
        ) as stream:
            for text in stream.text_stream:
                print(text, end="", flush=True)
            message = stream.get_final_message()
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")

    code = extract_code("".join(b.text for b in message.content if b.type == "text"))
    if args.out:
        out = args.out
    elif args.format == "react":
        out = Path(args.image.stem.title().replace("-", "").replace("_", "") + ".tsx")
    else:
        out = Path(args.image.stem + ".html")
    out.write_text(code, encoding="utf-8")
    print(f"\n\nWrote {out}")
    if args.format == "html":
        print(f"Open it directly: file://{out.resolve()}")


if __name__ == "__main__":
    main()
