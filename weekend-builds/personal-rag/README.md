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
