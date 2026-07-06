# Weekend Builds

Standalone weekend projects, independent of the Couple Lab app. Each folder
is self-contained — no shared code, no build step, Python 3.10+ standard
library only.

Project ideas from [kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds)
(vol-3, "Life-First Local Builds"), implemented from scratch. These two were
chosen because they run fully local — no API keys, no accounts, no hardware:

| Project | What it does | Run |
|---|---|---|
| [money-map](money-map/) | Analyze a bank CSV: spending by category/month + forgotten-subscription detection → MD/HTML report | `python3 money_map.py sample-statement.csv` |
| [ambient-dashboard](ambient-dashboard/) | Calm animated day/night display for a tablet: today's calendar, weather, tasks | `python3 server.py` → `localhost:8500` |

The other ideas in that repo (Personal RAG Assistant, AI Inbox Triage,
Screenshot-to-Code, Offline Voice Journal…) need an Anthropic API key,
email access, or a microphone — good next steps to build on your own
machine.
