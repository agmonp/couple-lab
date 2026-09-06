#!/usr/bin/env python3
"""MCP server exposing the Personal RAG to Claude and any MCP-compatible AI.

Thin MCP layer over rag_store.py (local BM25 over your documents). Tools:

    ping()                     — liveness check
    search_docs(query, top_k)  — BM25 chunks, no API call, no data leaves the box
    ask(question)              — full RAG: retrieve, answered by Claude

The document index is cached on disk: first ever build ~1 min, later starts ~2 s.
Configure via environment variables (all optional):

    RAG_DOCS       folders to index, ';'-separated   (default: your Desktop)
    RAG_EXCLUDES   extra folder-name patterns to skip (space/;/,-separated)
    ANTHROPIC_API_KEY                                 (required only for ask)

Run standalone for a smoke test:  python rag_mcp.py --selftest
Otherwise it is launched by an MCP client over stdio.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import rag                            # noqa: E402
import rag_store                      # noqa: E402
from rag_store import log             # noqa: E402

from mcp.server.fastmcp import FastMCP  # noqa: E402

mcp = FastMCP("personal-rag")


@mcp.tool()
def ping() -> str:
    """Cheap liveness check — returns 'pong' without touching the index."""
    return "pong"


@mcp.tool()
def search_docs(query: str, top_k: int = 4) -> list[dict]:
    """Search the user's local documents (BM25). Returns the top matching
    chunks with their source file and score. No LLM call; nothing leaves the
    machine. Use this to find grounding before answering."""
    index = rag_store.get_index()
    return [{"source": c["source"], "score": c["score"], "text": c["text"]}
            for c in index.search(query, top_k=top_k)]


@mcp.tool()
def ask(question: str) -> str:
    """Answer a question grounded in the user's documents: retrieves local
    chunks and has Claude answer over them. Requires ANTHROPIC_API_KEY.
    Prefer search_docs if you only need the raw grounding."""
    import anthropic

    grounding = rag_store.build_grounding(question)
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=rag.MODEL,
        max_tokens=4096,
        thinking={"type": "adaptive"},
        system=rag.SYSTEM,
        messages=[{"role": "user", "content": grounding["content"]}],
    )
    return "".join(b.text for b in msg.content if b.type == "text").strip()


def _warm_up() -> None:
    """Build the index ONCE, before the stdio transport starts — keeps
    rag.py's stdout prints away from the live MCP channel and makes the
    first real tool call fast."""
    log("warming up: indexing documents (first ever run can take ~1 min)...")
    try:
        idx = rag_store.get_index()
        log(f"index ready: {len(idx.chunks)} chunks")
    except SystemExit as e:      # load_chunks calls sys.exit if no docs found
        log(f"index NOT built: {e}")


def _selftest() -> None:
    """Exercise the tools without an MCP client (prints to stderr)."""
    log("Indexing", rag_store.docs(), "...")
    hits = search_docs("Lech", top_k=3)
    log(f"search_docs -> {len(hits)} hits; first: {hits[0]['source'] if hits else None}")
    log("OK (skipping ask() — that costs an API call). Add --ask to test it.")
    if "--ask" in sys.argv:
        log("ask ->", ask("Tell me about Lech")[:400])


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        _warm_up()
        mcp.run()  # stdio transport
