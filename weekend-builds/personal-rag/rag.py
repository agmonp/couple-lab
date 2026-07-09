#!/usr/bin/env python3
"""Personal RAG Assistant — chat with your own docs, with memory.

Drop .txt / .md / .pdf files into docs/, then:

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 rag.py            # interactive chat
    python3 rag.py --search "keyword"   # test retrieval only (no API call)

Retrieval is a local BM25 index built at startup — no vector database, no
embedding model, no data leaves your machine except the retrieved chunks
sent to Claude with your question. Conversation memory (last 10 exchanges)
persists in memory.json.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
DOCS_DIR = HERE / "docs"
MEMORY_FILE = HERE / "memory.json"
MODEL = "claude-opus-4-8"
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200
TOP_K = 4
MEMORY_TURNS = 10


# ---------------------------------------------------------------------------
# Document loading & chunking
# ---------------------------------------------------------------------------

def read_document(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            print(f"  skipping {path.name} (pip install pypdf to read PDFs)")
            return ""
        return "\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
    return path.read_text(encoding="utf-8", errors="replace")


def chunk_text(text: str, source: str) -> list[dict]:
    """Split on paragraph boundaries into ~CHUNK_SIZE chars with overlap."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, current = [], ""
    for p in paragraphs:
        if current and len(current) + len(p) > CHUNK_SIZE:
            chunks.append(current)
            current = current[-CHUNK_OVERLAP:] + "\n" + p  # keep overlap
        else:
            current = f"{current}\n\n{p}" if current else p
    if current.strip():
        chunks.append(current)
    return [{"source": source, "text": c.strip()} for c in chunks]


def load_chunks() -> list[dict]:
    DOCS_DIR.mkdir(exist_ok=True)
    chunks = []
    files = sorted(p for p in DOCS_DIR.rglob("*")
                   if p.suffix.lower() in (".txt", ".md", ".pdf") and p.is_file())
    if not files:
        sys.exit(f"No documents found. Put .txt / .md / .pdf files in {DOCS_DIR}/ and rerun.")
    for path in files:
        text = read_document(path)
        if text.strip():
            file_chunks = chunk_text(text, path.name)
            chunks.extend(file_chunks)
            print(f"  {path.name}: {len(file_chunks)} chunks")
    return chunks


# ---------------------------------------------------------------------------
# BM25 retrieval (pure Python — swap for embeddings later if you like)
# ---------------------------------------------------------------------------

def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z֐-׿À-ɏ0-9]+", text.lower())


class BM25:
    def __init__(self, chunks: list[dict], k1: float = 1.5, b: float = 0.75):
        self.chunks = chunks
        self.k1, self.b = k1, b
        self.doc_tokens = [tokenize(c["text"]) for c in chunks]
        self.doc_lengths = [len(t) for t in self.doc_tokens]
        self.avg_length = sum(self.doc_lengths) / max(len(self.doc_lengths), 1)
        self.term_freqs = [Counter(t) for t in self.doc_tokens]
        doc_freq: Counter = Counter()
        for tokens in self.doc_tokens:
            doc_freq.update(set(tokens))
        n = len(chunks)
        self.idf = {term: math.log(1 + (n - df + 0.5) / (df + 0.5))
                    for term, df in doc_freq.items()}

    def search(self, query: str, top_k: int = TOP_K) -> list[dict]:
        q_tokens = tokenize(query)
        scores = []
        for i, tf in enumerate(self.term_freqs):
            score = 0.0
            norm = self.k1 * (1 - self.b + self.b * self.doc_lengths[i] / self.avg_length)
            for term in q_tokens:
                if term in tf:
                    score += self.idf[term] * tf[term] * (self.k1 + 1) / (tf[term] + norm)
            scores.append((score, i))
        scores.sort(reverse=True)
        return [dict(self.chunks[i], score=round(s, 2)) for s, i in scores[:top_k] if s > 0]


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------

def load_memory() -> list[dict]:
    if MEMORY_FILE.exists():
        return json.loads(MEMORY_FILE.read_text(encoding="utf-8"))
    return []


def save_memory(memory: list[dict]) -> None:
    MEMORY_FILE.write_text(json.dumps(memory[-MEMORY_TURNS * 2:], ensure_ascii=False, indent=1),
                           encoding="utf-8")


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

SYSTEM = """You are a personal assistant answering questions about the user's own documents.
Ground every answer in the provided context chunks and cite the source file names.
If the context doesn't contain the answer, say so plainly instead of guessing.
Answer in the language the user asked in."""


def chat(index: BM25) -> None:
    import anthropic

    client = anthropic.Anthropic()
    memory = load_memory()
    print("\nAsk about your documents (quit/exit/q to stop).")
    while True:
        try:
            question = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not question or question.lower() in ("quit", "exit", "q"):
            break

        retrieved = index.search(question)
        context = "\n\n---\n\n".join(f"[{c['source']}]\n{c['text']}" for c in retrieved) \
            or "(no relevant chunks found)"
        messages = memory + [{
            "role": "user",
            "content": f"<context>\n{context}\n</context>\n\nQuestion: {question}",
        }]

        try:
            print("\nAssistant: ", end="", flush=True)
            with client.messages.stream(
                model=MODEL,
                max_tokens=4096,
                thinking={"type": "adaptive"},
                system=SYSTEM,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    print(text, end="", flush=True)
                answer = stream.get_final_message()
            print()
        except anthropic.AuthenticationError:
            sys.exit("\nSet ANTHROPIC_API_KEY (get one at console.anthropic.com).")
        except anthropic.APIStatusError as exc:
            print(f"\nAPI error {exc.status_code}: {exc.message}")
            continue

        answer_text = "".join(b.text for b in answer.content if b.type == "text")
        memory += [
            {"role": "user", "content": question},
            {"role": "assistant", "content": answer_text},
        ]
        save_memory(memory)


def main() -> None:
    parser = argparse.ArgumentParser(description="Chat with your own documents.")
    parser.add_argument("--search", help="Test retrieval only: print top chunks, no API call")
    parser.add_argument("--forget", action="store_true", help="Clear conversation memory")
    args = parser.parse_args()

    if args.forget and MEMORY_FILE.exists():
        MEMORY_FILE.unlink()
        print("Memory cleared.")

    print(f"Indexing {DOCS_DIR}/ ...")
    index = BM25(load_chunks())
    print(f"Indexed {len(index.chunks)} chunks.")

    if args.search:
        for c in index.search(args.search):
            print(f"\n--- {c['source']} (score {c['score']}) ---\n{c['text'][:400]}")
        return

    chat(index)


if __name__ == "__main__":
    main()
