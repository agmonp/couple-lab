#!/usr/bin/env python3
"""Offline Voice Journal — talk to your phone, see your week's patterns.

Record voice memos (phone, recorder app, whatever), drop the audio files in
audio/, then:

    pip install faster-whisper          # local speech-to-text, runs on CPU
    python3 journal.py transcribe       # audio/*.m4a → transcripts/YYYY-MM-DD-*.md
    python3 journal.py review           # local pattern stats for the last 7 days
    python3 journal.py review --ai      # + a Claude reflection (only step that goes online)

Everything except the optional --ai step runs entirely on your machine.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent
AUDIO_DIR = HERE / "audio"
TRANSCRIPTS_DIR = HERE / "transcripts"
AUDIO_EXTS = (".m4a", ".mp3", ".wav", ".ogg", ".flac", ".webm", ".mp4")

STOPWORDS = set("""a an and are as at be but by for from had has have i i'm im in is it its
just like me my of on or so that the them they this to was we were with you your not no yes
really very going get got kind know think thing things dont don't
של את זה על אני לא עם היה הוא היא אבל גם כי מה יש אז רק עוד כמו אם או הם אנחנו לי שאני""".split())


def transcribe() -> None:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("pip install faster-whisper  (local model, no API, no upload)")

    AUDIO_DIR.mkdir(exist_ok=True)
    TRANSCRIPTS_DIR.mkdir(exist_ok=True)
    files = sorted(p for p in AUDIO_DIR.iterdir() if p.suffix.lower() in AUDIO_EXTS)
    if not files:
        sys.exit(f"Put voice memos in {AUDIO_DIR}/ first ({', '.join(AUDIO_EXTS)}).")

    print("Loading whisper model (first run downloads ~150MB, then it's offline)...")
    model = WhisperModel("small", compute_type="int8")
    for path in files:
        day = datetime.fromtimestamp(path.stat().st_mtime).date()
        out = TRANSCRIPTS_DIR / f"{day}-{path.stem}.md"
        if out.exists():
            print(f"  {path.name}: already transcribed")
            continue
        print(f"  {path.name} → {out.name}")
        segments, info = model.transcribe(str(path))
        text = " ".join(s.text.strip() for s in segments)
        out.write_text(f"# {day} — {path.stem}\n\n{text}\n", encoding="utf-8")
    print("Done. Audio never left this machine.")


def load_entries(days: int) -> list[tuple[date, str]]:
    TRANSCRIPTS_DIR.mkdir(exist_ok=True)
    cutoff = date.today() - timedelta(days=days)
    entries = []
    for path in sorted(TRANSCRIPTS_DIR.glob("*.md")):
        match = re.match(r"(\d{4}-\d{2}-\d{2})", path.name)
        if not match:
            continue
        day = date.fromisoformat(match.group(1))
        if day >= cutoff:
            entries.append((day, path.read_text(encoding="utf-8")))
    return entries


def words_of(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-zA-Z֐-׿À-ɏ']{3,}", text.lower())
            if w not in STOPWORDS]


def review(days: int, use_ai: bool) -> None:
    entries = load_entries(days)
    if not entries:
        sys.exit(f"No transcripts from the last {days} days. Run `transcribe` first.")

    all_words = []
    print(f"── Last {days} days: {len(entries)} entries\n")
    for day, text in entries:
        words = words_of(text)
        all_words += words
        print(f"  {day}  {len(text.split()):>5} words")

    counts = Counter(all_words)
    bigrams = Counter(
        f"{a} {b}" for text in (t for _, t in entries)
        for a, b in zip(words_of(text), words_of(text)[1:])
    )
    print("\n── What you kept talking about")
    for word, n in counts.most_common(12):
        print(f"  {word:<20} ×{n}")
    repeated = [(b, n) for b, n in bigrams.most_common(8) if n > 1]
    if repeated:
        print("\n── Recurring phrases")
        for phrase, n in repeated:
            print(f"  {phrase:<28} ×{n}")

    if not use_ai:
        print("\n(run with --ai for a reflective summary via Claude — "
              "that's the only step that sends transcripts anywhere)")
        return

    import anthropic

    corpus = "\n\n".join(f"### {d}\n{t}" for d, t in entries)[:150000]
    print(f"\n{'=' * 60}\n")
    try:
        client = anthropic.Anthropic()
        with client.messages.stream(
            model="claude-opus-4-8",
            max_tokens=8192,
            thinking={"type": "adaptive"},
            system="""You reflect back a week of someone's voice-journal entries.
Identify: recurring themes and worries, mood trajectory across the days,
things they said they'd do (and whether later entries mention doing them),
and one gentle, concrete suggestion. Ground every observation in their own
words (quote briefly). Warm, non-clinical, no diagnosis. Their language.""",
            messages=[{"role": "user", "content": corpus}],
        ) as stream:
            for text in stream.text_stream:
                print(text, end="", flush=True)
        print()
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Offline voice journal.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("transcribe", help="Transcribe audio/ locally with whisper")
    review_p = sub.add_parser("review", help="Pattern stats for recent entries")
    review_p.add_argument("--days", type=int, default=7)
    review_p.add_argument("--ai", action="store_true",
                          help="Add a Claude reflection (sends transcripts to the API)")
    args = parser.parse_args()

    if args.command == "transcribe":
        transcribe()
    else:
        review(args.days, args.ai)


if __name__ == "__main__":
    main()
