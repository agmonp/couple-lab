# Personal RAG Assistant

**Chat with your own docs, PDFs, and notes — with conversation memory.**

Drop files into `docs/`, run one script, ask questions in natural language.
Answers are grounded in your documents with source-file citations, and the
assistant remembers the last 10 exchanges so follow-up questions work.

Based on the *Personal RAG Assistant* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds).
This implementation swaps the original LangChain + ChromaDB + HuggingFace
stack for a **pure-Python BM25 index** — the only dependency is the
`anthropic` SDK, indexing is instant, and nothing but the few retrieved
chunks ever leaves your machine.

## Setup

```bash
pip install anthropic          # + pypdf if you want PDF support
export ANTHROPIC_API_KEY=sk-ant-...
```

## Use

```bash
# 1. Add documents
cp ~/my-notes/*.md docs/

# 2. Chat
python3 rag.py
You: what did I decide about the kitchen renovation?
Assistant: According to renovation-notes.md, you decided ...

# Test retrieval without an API call
python3 rag.py --search "renovation budget"

# Clear conversation memory
python3 rag.py --forget
```

### Index any folder (e.g. your Desktop)

```bash
# macOS / Linux
python3 rag.py --docs ~/Desktop ~/Documents --exclude drafts

# Windows
python rag.py --docs "C:\Users\<you>\Desktop" --exclude טיוטות
```

Only `.txt` / `.md` / `.pdf` files are read — images and other binaries are
skipped automatically, and common image/junk folders (`Pictures`, `תמונות`,
`images`, `photos`, `.git`, `node_modules`, …) are pruned by default.
`--exclude` adds your own folder-name patterns. Files over 20MB are skipped.

### Optional: GraphRAG with Neo4j

Already keep a personal knowledge graph (people, events, places) in Neo4j?
Blend it into the context:

```bash
pip install neo4j
export NEO4J_URI=bolt://localhost:7687 NEO4J_USER=neo4j NEO4J_PASSWORD=...
python3 rag.py --graph
```

Per question, the entities in your question are matched against node
properties and their immediate relationships come back as readable triples —
`(Dana:Person) -[KNOWS]-> (Yossi:Person)` — in a `<graph>` section next to
the text chunks. If the graph is unreachable, the assistant runs without it.

**Does a graph improve RAG, or weigh it down?** It depends on the questions:

| Question shape | Winner |
|---|---|
| "What does my lease say about X?" (facts inside one document) | Text retrieval — the graph adds nothing |
| "Who was involved in X?", "What connects A to B?", "What happened around Y?" (relations across entities) | Graph — keyword/vector retrieval routinely misses multi-hop links |

The costs are real: a running Neo4j, ingestion upkeep, and per-question
latency. That's why here it's a **flag, not a dependency** — the text path
never pays for the graph, and you can A/B the same question with and without
`--graph` to see if *your* graph earns its keep.

## How it works

```
docs/*.{txt,md,pdf} → paragraph chunks (~1000 chars, 200 overlap)
                    → BM25 index (in memory, built at startup)
question            → top-4 chunks → Claude (claude-opus-4-8, adaptive thinking)
                    → streamed answer with [source.md] citations
memory.json         ← last 10 exchanges, replayed on every turn
```

## Make it yours

- **Better retrieval** — swap `BM25` for embeddings (e.g. voyage-3 or a local
  sentence-transformers model + ChromaDB) once your corpus outgrows keyword
  search. The `search(query) -> chunks` interface is the only contract.
- **Tune chunking** — `CHUNK_SIZE` / `CHUNK_OVERLAP` at the top of `rag.py`.
- **More memory** — raise `MEMORY_TURNS`; the file is plain JSON you can read.
