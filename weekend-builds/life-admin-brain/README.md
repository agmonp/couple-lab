# Life Admin Brain

**Ask your lease, insurance, and contracts questions — get the exact clause back.**

```bash
pip install anthropic            # + pypdf for PDF files
export ANTHROPIC_API_KEY=sk-ant-...

# 1. Drop the paperwork into documents/ (.pdf / .txt / .md)
# 2. Ask
python3 brain.py ask "how much notice do I need to give before moving out?"
python3 brain.py ask "who pays for the water heater?" --show-chunks  # retrieval only, no API

# What do I even have, and which deadlines matter?
python3 brain.py inventory
```

Answers always quote the clause and name the file, end with a plain-language
"Bottom line:", and refuse to guess at terms the documents don't settle.
`inventory` summarizes every document and finishes with a **"dates to put in
your calendar"** list — renewal windows, notice deadlines, expiries.

Based on the *Life Admin Brain* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds) (vol-3),
keeping its life-first stance: retrieval is a local BM25 index, so your
documents stay on your machine — only the few retrieved passages go to Claude.

A `documents/sample-lease.md` is included so you can try both commands
immediately.

## vs. personal-rag

Same retrieval core as [`../personal-rag`](../personal-rag), different job:
one-shot factual lookup with mandatory quotes and citations (not a chat),
plus the inventory/deadlines view. Copy whichever shape fits your next idea.
