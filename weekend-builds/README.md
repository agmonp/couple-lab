# Weekend Builds

Fifteen standalone weekend projects, independent of the Couple Lab app.
Each folder is self-contained — no shared code, one main script, a README,
and sample data where useful.

Project ideas from [kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds)
by [@qendresahhoti](https://github.com/qendresahhoti), implemented from scratch.
Projects marked 🔑 call the Claude API (`pip install anthropic` +
`export ANTHROPIC_API_KEY=...`); the others run fully offline.

## Fully local — run them right now

| Project | What it does |
|---|---|
| [money-map](money-map/) | Bank CSV → spending breakdown + forgotten-subscription flags (MD/HTML report) |
| [ambient-dashboard](ambient-dashboard/) | Calm animated day/night display for a tablet: calendar, weather, tasks |
| [decision-simulator](decision-simulator/) | Monte Carlo over a big decision: distributions, P(A beats B), downside view (🔑 optional narrative) |
| [voice-journal](voice-journal/) | Voice memos → local whisper transcripts → weekly pattern stats (🔑 optional reflection) |

## Claude-powered 🔑

| Project | What it does | Pattern it teaches |
|---|---|---|
| [personal-rag](personal-rag/) | Chat with your docs + conversation memory | RAG (local BM25 retrieval) |
| [life-admin-brain](life-admin-brain/) | Ask your lease/policies questions, get the exact clause + calendar-worthy dates | RAG with citations |
| [web-researcher](web-researcher/) | Topic → sourced research report | server-side web search/fetch tools |
| [research-crew](research-crew/) | Researcher → analyst → writer pipeline | multi-agent orchestration |
| [excalidraw-diagrams](excalidraw-diagrams/) | Describe a system → editable .excalidraw file | structured outputs + deterministic rendering |
| [coding-agent](coding-agent/) | Task + repo → explored, edited, tested fix | tool runner agent loop |
| [screenshot-to-code](screenshot-to-code/) | UI image → React component / HTML page | vision |
| [daily-digest](daily-digest/) | RSS feeds → one ranked morning briefing (+email) | automation pipeline |
| [skill-builder](skill-builder/) | Chat transcript → installable SKILL.md files | structure extraction |
| [content-repurposer](content-repurposer/) | One post → Twitter/LinkedIn/newsletter/IG/YouTube, same voice | prompt chaining |
| [inbox-triage](inbox-triage/) | IMAP inbox → triage board + ready-to-edit reply drafts | agent loop w/ human in the loop |

## Conventions

- Python 3.10+; the only dependency is `anthropic` (plus opt-ins:
  `pypdf` for PDFs, `faster-whisper` for the voice journal).
- Model: `claude-opus-4-8` with adaptive thinking; long outputs stream.
- Local-first wherever possible: retrieval, parsing, stats, and simulation
  run on your machine; only what must reach the model is sent.
- Nothing sends email, replies, or pushes code without you reviewing it first.
