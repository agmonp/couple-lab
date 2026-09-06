# Multi-Agent Research Crew

**A team of agents that research, summarize, and report together.**

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...

python3 crew.py "should a small startup adopt passkeys in 2026?"
```

Three agents run in sequence, each a separate Claude conversation with its
own role and system prompt:

| Agent | Job | Tools |
|---|---|---|
| **Researcher** | Gathers sourced facts, covers multiple viewpoints | web search |
| **Analyst** | Stress-tests the notes — gaps, weak claims, counterarguments | — |
| **Writer** | Produces the final report, honoring the critique | — |

Every stage's output is saved to `output/<date>-<topic>/` (`1-research-notes.md`,
`2-analyst-critique.md`, `3-final-report.md`) so you can see exactly what each
agent contributed — that transparency is the point of the exercise.

Based on the *Multi-Agent Research Crew* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds).

## Make it yours

- Add a **fact-checker** agent between analyst and writer that re-searches
  the three weakest claims.
- Give the analyst search access too, so it can verify instead of only argue.
- Swap the writer's system prompt to match your house style.
