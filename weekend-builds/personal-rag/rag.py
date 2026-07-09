#!/usr/bin/env python3
"""Personal RAG Assistant — chat with your own docs, with memory.

Drop .txt / .md / .pdf files into docs/ (or point --docs at any folder), then:

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 rag.py                        # interactive chat over ./docs
    python3 rag.py --docs ~/Desktop --exclude Pictures תמונות
    python3 rag.py --search "keyword"     # test retrieval only (no API call)

Retrieval is a local BM25 index built at startup — no vector database, no
embedding model, no data leaves your machine except the retrieved chunks
sent to Claude with your question. Conversation memory (last 10 exchanges)
persists in memory.json.

Optional GraphRAG: if you keep a knowledge graph in Neo4j (people, events,
places...), add --graph and set NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD.
Facts from the graph neighborhood of your question are added to the context
alongside the text chunks (pip install neo4j).
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
MAX_FILE_MB = 20
TEXT_EXTS = (".txt", ".md", ".pdf")

# Folders skipped by default when indexing arbitrary directories (--docs).
# Images and other binary files are skipped anyway (only TEXT_EXTS are read);
# these prune whole subtrees for speed. Add your own with --exclude.
DEFAULT_EXCLUDES = ["pictures", "תמונות", "images", "photos", "camera",
                    ".git", "node_modules", "__pycache__", "venv", ".venv",
                    "appdata", "library", "$recycle.bin"]


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


def is_excluded(path: Path, root: Path, excludes: list[str]) -> bool:
    relative_parts = [p.lower() for p in path.relative_to(root).parts]
    return any(pattern.lower() in part for pattern in excludes for part in relative_parts)


def load_chunks(roots: list[Path], excludes: list[str]) -> list[dict]:
    chunks = []
    for root in roots:
        root = root.expanduser().resolve()
        if not root.is_dir():
            sys.exit(f"No such folder: {root}")
        files = sorted(p for p in root.rglob("*")
                       if p.is_file() and p.suffix.lower() in TEXT_EXTS
                       and not is_excluded(p, root, excludes)
                       and p.stat().st_size <= MAX_FILE_MB * 1024 * 1024)
        for path in files:
            try:
                text = read_document(path)
            except Exception as exc:  # one unreadable file shouldn't kill the index
                print(f"  {path.name}: skipped ({exc})")
                continue
            if text.strip():
                label = str(path.relative_to(root))
                file_chunks = chunk_text(text, label)
                chunks.extend(file_chunks)
                print(f"  {label}: {len(file_chunks)} chunks")
    if not chunks:
        sys.exit(f"No readable {'/'.join(TEXT_EXTS)} documents found under "
                 f"{', '.join(str(r) for r in roots)}.")
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
# GraphRAG — optional Neo4j knowledge-graph context
# ---------------------------------------------------------------------------

class GraphContext:
    """Pulls facts from a Neo4j graph around the entities in a question.

    For each meaningful question term, finds nodes whose string properties
    contain it and returns their immediate relationships as readable triples:
        (Dana:Person) -[KNOWS]-> (Yossi:Person)
    """

    def __init__(self, uri: str, user: str, password: str):
        from neo4j import GraphDatabase  # pip install neo4j
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.driver.verify_connectivity()

    @staticmethod
    def describe(node) -> str:
        props = dict(node)
        name = next((props[k] for k in ("name", "title", "id", "label")
                     if props.get(k)), None) or str(props)[:60]
        labels = ":".join(node.labels) or "Node"
        return f"({name}:{labels})"

    def facts(self, question: str, limit: int = 30) -> list[str]:
        terms = [t for t in set(tokenize(question)) if len(t) > 2][:8]
        if not terms:
            return []
        facts: list[str] = []
        with self.driver.session() as session:
            for term in terms:
                result = session.run(
                    "MATCH (n) "
                    "WHERE any(k IN keys(n) WHERE toLower(toString(n[k])) CONTAINS $term) "
                    "OPTIONAL MATCH (n)-[r]-(m) "
                    "RETURN n, type(r) AS rel, m, startNode(r) = n AS outgoing "
                    "LIMIT $limit",
                    term=term, limit=limit)
                for record in result:
                    n = self.describe(record["n"])
                    if record["rel"] is None:
                        facts.append(n)
                    elif record["outgoing"]:
                        facts.append(f"{n} -[{record['rel']}]-> {self.describe(record['m'])}")
                    else:
                        facts.append(f"{self.describe(record['m'])} -[{record['rel']}]-> {n}")
        seen, unique = set(), []
        for fact in facts:
            if fact not in seen:
                seen.add(fact)
                unique.append(fact)
        return unique[:limit]


def connect_graph() -> GraphContext | None:
    import os

    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "")
    try:
        graph = GraphContext(uri, user, password)
        print(f"Graph connected: {uri}")
        return graph
    except ImportError:
        print("Graph disabled: pip install neo4j")
    except Exception as exc:
        print(f"Graph disabled: cannot reach {uri} ({exc})")
    return None


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
A <graph> section, when present, contains facts from the user's personal knowledge
graph — treat them as reliable structured facts and cite them as (graph).
If the context doesn't contain the answer, say so plainly instead of guessing.
Answer in the language the user asked in."""


def chat(index: BM25, graph: GraphContext | None = None) -> None:
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
        user_content = f"<context>\n{context}\n</context>"
        if graph is not None:
            facts = graph.facts(question)
            if facts:
                user_content += "\n\n<graph>\n" + "\n".join(facts) + "\n</graph>"
        user_content += f"\n\nQuestion: {question}"
        messages = memory + [{"role": "user", "content": user_content}]

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
    parser.add_argument("--docs", nargs="+", type=Path, default=[DOCS_DIR],
                        help="Folder(s) to index (default: ./docs). "
                             "Example: --docs ~/Desktop ~/Documents")
    parser.add_argument("--exclude", nargs="*", default=[],
                        help="Extra folder-name patterns to skip "
                             f"(always skipped: {', '.join(DEFAULT_EXCLUDES[:5])}...)")
    parser.add_argument("--graph", action="store_true",
                        help="Also pull facts from a Neo4j knowledge graph "
                             "(NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD)")
    parser.add_argument("--search", help="Test retrieval only: print top chunks, no API call")
    parser.add_argument("--forget", action="store_true", help="Clear conversation memory")
    args = parser.parse_args()

    if args.forget and MEMORY_FILE.exists():
        MEMORY_FILE.unlink()
        print("Memory cleared.")

    if args.docs == [DOCS_DIR]:
        DOCS_DIR.mkdir(exist_ok=True)
    print(f"Indexing {', '.join(str(d) for d in args.docs)} ...")
    index = BM25(load_chunks(args.docs, DEFAULT_EXCLUDES + args.exclude))
    print(f"Indexed {len(index.chunks)} chunks.")

    if args.search:
        for c in index.search(args.search):
            print(f"\n--- {c['source']} (score {c['score']}) ---\n{c['text'][:400]}")
        return

    graph = connect_graph() if args.graph else None
    chat(index, graph)


if __name__ == "__main__":
    main()
