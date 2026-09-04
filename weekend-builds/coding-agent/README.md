# Autonomous Coding Agent

**Give it a task and a repo — it explores, edits, runs the tests, and iterates
until done.**

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...

python3 agent.py "the CLI crashes on empty input — add a failing test, then fix it" \
    --repo ~/code/mytool

# Or feed it a GitHub issue you saved to a file:
python3 agent.py --issue issue.md --repo ~/code/mytool
```

Based on the *Autonomous Coding Agent* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds).

## How it works

Three tools — `bash`, `read_file`, `write_file` — defined with the SDK's
`@beta_tool` decorator, driven by `client.beta.messages.tool_runner(...)`.
The SDK owns the request → execute → loop cycle, so the whole agentic loop is
a `for message in runner:` — the interesting part is the **system prompt**
(explore first, smallest change, verify with tests, summarize) and the tools'
guardrails:

- File reads/writes are **confined to the repo** (path-escape check).
- Commands time out after 180s and run with `cwd` = repo root.
- Loop is capped at 40 iterations.
- At the end the script prints `git diff --stat` so you review everything.

## ⚠️ Safety

The agent executes shell commands. Run it on a repo with a **clean git
state**, in a container/VM if the repo is untrusted, and read the transcript —
it prints every command and file write as it happens.

## Make it yours

- Add a `run_tests` tool that wraps your project's exact test command.
- Gate `bash` behind interactive confirmation for non-allowlisted commands.
- Wire it to real GitHub issues (fetch issue → run agent → open a PR).
