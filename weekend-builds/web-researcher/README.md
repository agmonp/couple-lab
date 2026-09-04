# One-Command Web Researcher

**Type a topic → get a full research report, with sources.**

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...

python3 research.py "state of solid-state batteries 2026"
python3 research.py "https://example.com/long-article" --questions "who benefits, main risks"
```

The report streams to your terminal and is saved to `reports/<date>-<topic>.md`
with an executive summary, key findings, disagreements between sources, and a
source list.

Based on the *One-Command Web Researcher* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds).
This implementation uses Claude's **server-side `web_search` + `web_fetch`
tools** — searching, fetching, and filtering all happen on Anthropic's side,
so there is no scraping code and no separate search-API key to manage.

## Options

| Flag | Meaning |
|---|---|
| `--questions "..."` | Force the report to answer specific questions |
| `--max-searches N` | Cap web searches per run (default 8) |

## Notes

- Long research turns can pause (`pause_turn`); the script resumes
  automatically until the report is complete.
- Works in any language — the report matches the language of your prompt.
