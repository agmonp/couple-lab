#!/usr/bin/env python3
"""Life Admin Brain — ask questions about your leases, policies, and contracts.

Put the paperwork (lease, insurance policies, warranties, employment
contract...) as .pdf / .txt / .md into documents/, then:

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 brain.py ask "how much notice do I need to give before moving out?"
    python3 brain.py inventory      # what do I even have, and which dates matter?

Answers quote the exact clause and name the file it came from. Retrieval is
local (BM25); only the retrieved passages are sent to Claude.
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from collections import Counter
from pathlib import Path

import anthropic

MODEL = "claude-opus-4-8"
HERE = Path(__file__).parent
DOCS_DIR = HERE / "documents"
CHUNK_SIZE = 1200
TOP_K = 6

ANSWER_SYSTEM = """You answer questions about the user's personal admin documents
(leases, insurance, warranties, contracts) from the provided excerpts.

Rules:
- Quote the exact clause(s) you rely on, and name the source file for each.
- If the excerpts don't settle the question, say exactly what's missing —
  never guess at legal or financial terms.
- Finish with "Bottom line:" — one plain-language sentence.
- Answer in the user's language; keep quotes in their original language.
This is document lookup, not legal advice — say so if the stakes look high."""

INVENTORY_SYSTEM = """Summarize each personal-admin document you are given. For each:
- What it is (one line)
- The parties / provider
- Key amounts (rent, premium, coverage, salary...)
- Every date and deadline it contains (renewal, notice period, expiry) —
  these matter most
- One thing the owner probably forgot is in there
End with a combined "Dates to put in your calendar" list, soonest first."""


def read_document(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            print(f"  skipping {path.name} (pip install pypdf for PDF support)")
            return ""
        return "\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
    return path.read_text(encoding="utf-8", errors="replace")


def load_chunks() -> list[dict]:
    DOCS_DIR.mkdir(exist_ok=True)
    files = sorted(p for p in DOCS_DIR.rglob("*")
                   if p.suffix.lower() in (".pdf", ".txt", ".md") and p.is_file())
    if not files:
        sys.exit(f"Put your documents (.pdf/.txt/.md) in {DOCS_DIR}/ first.")
    chunks = []
    for path in files:
        text = read_document(path)
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
        current = ""
        for p in paragraphs:
            if current and len(current) + len(p) > CHUNK_SIZE:
                chunks.append({"source": path.name, "text": current.strip()})
                current = p
            else:
                current = f"{current}\n\n{p}" if current else p
        if current.strip():
            chunks.append({"source": path.name, "text": current.strip()})
    return chunks


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z֐-׿À-ɏ0-9]+", text.lower())


def bm25_search(chunks: list[dict], query: str, top_k: int = TOP_K) -> list[dict]:
    doc_tokens = [tokenize(c["text"]) for c in chunks]
    avg_len = sum(len(t) for t in doc_tokens) / max(len(doc_tokens), 1)
    doc_freq: Counter = Counter()
    for tokens in doc_tokens:
        doc_freq.update(set(tokens))
    n, k1, b = len(chunks), 1.5, 0.75
    scores = []
    for i, tokens in enumerate(doc_tokens):
        tf = Counter(tokens)
        norm = k1 * (1 - b + b * len(tokens) / avg_len)
        score = sum(
            math.log(1 + (n - doc_freq[t] + 0.5) / (doc_freq[t] + 0.5))
            * tf[t] * (k1 + 1) / (tf[t] + norm)
            for t in set(tokenize(query)) if t in tf
        )
        scores.append((score, i))
    scores.sort(reverse=True)
    return [chunks[i] for s, i in scores[:top_k] if s > 0]


def call_claude(system: str, prompt: str) -> None:
    client = anthropic.Anthropic()
    try:
        with client.messages.stream(
            model=MODEL, max_tokens=8192, thinking={"type": "adaptive"},
            system=system, messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                print(text, end="", flush=True)
        print()
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Q&A over your life-admin documents.")
    sub = parser.add_subparsers(dest="command", required=True)
    ask = sub.add_parser("ask", help="Ask a question")
    ask.add_argument("question")
    ask.add_argument("--show-chunks", action="store_true",
                     help="Print retrieved excerpts without calling the API")
    sub.add_parser("inventory", help="Summarize every document + key dates")
    args = parser.parse_args()

    chunks = load_chunks()
    sources = sorted({c["source"] for c in chunks})
    print(f"Loaded {len(chunks)} passages from {len(sources)} document(s).\n")

    if args.command == "ask":
        retrieved = bm25_search(chunks, args.question)
        if args.show_chunks:
            for c in retrieved:
                print(f"--- {c['source']} ---\n{c['text'][:500]}\n")
            return
        context = "\n\n".join(f"[{c['source']}]\n{c['text']}" for c in retrieved) \
            or "(nothing relevant found)"
        call_claude(ANSWER_SYSTEM,
                    f"<excerpts>\n{context}\n</excerpts>\n\nQuestion: {args.question}")
    else:  # inventory
        # Send each document's chunks (truncated) — small personal corpora fit fine.
        joined = "\n\n".join(f"[{c['source']}]\n{c['text']}" for c in chunks)[:300000]
        call_claude(INVENTORY_SYSTEM, joined)


if __name__ == "__main__":
    main()
