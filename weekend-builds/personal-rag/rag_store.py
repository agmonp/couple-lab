#!/usr/bin/env python3
"""Shared RAG store — one source of truth for every surface (MCP server,
local-ai-companion endpoints, CLI tools).

Wraps rag.py with:
  * env-var configuration (RAG_DOCS / RAG_EXCLUDES)
  * a disk cache for the BM25 index (first build ~1 min, later loads ~2 s)
  * a lazy singleton for the index
  * build_grounding() — the retrieve-chunks step every surface shares

stdout discipline: rag.py prints progress to stdout, which corrupts MCP stdio.
All builders here capture stdout; log to stderr only.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import os
import pickle
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import rag  # noqa: E402  — the same retrieval / chunking / prompt code the CLI uses

CACHE_FILE = Path(__file__).parent / ".rag_index_cache.pkl"
DEFAULT_DOCS = os.path.join(os.path.expanduser("~"), "Desktop")
# Build junk that pollutes a Desktop index (tuned on the CLI).
BASE_EXTRA_EXCLUDES = ["obj", "bin", "node_modules", "ZxcvbnData",
                       "Edge Wallet", "LICENSE.txt"]

_index: "rag.BM25 | None" = None


def log(*a) -> None:
    print("[rag_store]", *a, file=sys.stderr, flush=True)


def docs() -> list[Path]:
    raw = os.environ.get("RAG_DOCS", DEFAULT_DOCS)
    return [Path(p) for p in raw.split(";") if p.strip()]


def excludes() -> list[str]:
    extra = re.split(r"[;,\s]+", os.environ.get("RAG_EXCLUDES", "").strip())
    return BASE_EXTRA_EXCLUDES + [e for e in extra if e]


def _signature() -> str:
    """Cheap corpus fingerprint (paths + size + mtime) — no file reads."""
    exc = rag.DEFAULT_EXCLUDES + excludes()
    entries = []
    for root in docs():
        root = root.expanduser().resolve()
        if not root.is_dir():
            continue
        for p in root.rglob("*"):
            if (p.is_file() and p.suffix.lower() in rag.TEXT_EXTS
                    and not rag.is_excluded(p, root, exc)):
                try:
                    st = p.stat()
                    if st.st_size <= rag.MAX_FILE_MB * 1024 * 1024:
                        entries.append(f"{p}|{st.st_size}|{int(st.st_mtime)}")
                except OSError:
                    continue
    entries.sort()
    return hashlib.sha256("\n".join(entries).encode("utf-8")).hexdigest()


def get_index() -> "rag.BM25":
    """Build (or load from cache) the BM25 index. Blocking — call off the
    event loop (e.g. asyncio.to_thread) from async code."""
    global _index
    if _index is not None:
        return _index
    sig = _signature()
    if CACHE_FILE.exists():
        try:
            cached = pickle.loads(CACHE_FILE.read_bytes())
            if cached.get("sig") == sig:
                _index = cached["index"]
                log("index loaded from cache")
                return _index
        except Exception as e:      # corrupt/incompatible cache → rebuild
            log(f"cache unreadable ({e}); rebuilding")
    with contextlib.redirect_stdout(io.StringIO()):
        chunks = rag.load_chunks(docs(), rag.DEFAULT_EXCLUDES + excludes())
        _index = rag.BM25(chunks)
    try:
        CACHE_FILE.write_bytes(pickle.dumps({"sig": sig, "index": _index}))
        log(f"index built and cached: {len(_index.chunks)} chunks")
    except Exception as e:
        log(f"could not write cache ({e})")
    return _index


def build_grounding(question: str, top_k: int = rag.TOP_K) -> dict:
    """The shared retrieval step: BM25 chunks for a question. Returns
    {"chunks": [...], "content": str} where content is the exact <context>
    block rag.py's chat sends to the model."""
    index = get_index()
    retrieved = index.search(question, top_k=top_k)
    context = "\n\n---\n\n".join(f"[{c['source']}]\n{c['text']}" for c in retrieved) \
        or "(no relevant chunks found)"
    content = f"<context>\n{context}\n</context>"
    content += f"\n\nQuestion: {question}"
    return {"chunks": retrieved, "content": content}
