# Personal RAG — MCP server

`rag_mcp.py` exposes your local RAG (BM25 over your documents)
to Claude and any MCP-compatible AI, as tools:

| tool | what it does | needs API key? |
|------|--------------|:---:|
| `search_docs(query, top_k)` | top BM25 chunks from your docs | no |
| `ask(question)` | retrieve, answered by Claude | **yes** |
| `ping()` | liveness check | no |

**The high-value tool (`search_docs`) needs no API key** — a capable
client (like Claude) can retrieve grounding with it and answer itself, so you can
leave `ask` (and the key) out entirely.

## First run
The server indexes your Desktop on first start (~1 min) and caches it to
`.rag_index_cache.pkl`; later starts load in ~2 s. The cache auto-rebuilds when
documents change (it fingerprints paths + sizes + mtimes).

## Register it

### Claude Code
```bash
claude mcp add personal-rag -- python "C:\Users\User\couple-lab\weekend-builds\personal-rag\rag_mcp.py"
```
…then add the env vars below, or drop a project-scoped `.mcp.json` (see `mcp.example.json`).

### Claude Desktop
Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):
```json
{
  "mcpServers": {
    "personal-rag": {
      "command": "python",
      "args": ["C:\\Users\\User\\couple-lab\\weekend-builds\\personal-rag\\rag_mcp.py"],
      "env": {
        "PYTHONUTF8": "1"
      }
    }
  }
}
```
Add `"ANTHROPIC_API_KEY": "sk-ant-..."` to that `env` block **only** if you want the
`ask` tool. Restart the client after editing.

## Config knobs (all optional env vars)
- `RAG_DOCS` — folders to index, `;`-separated (default: your Desktop)
- `RAG_EXCLUDES` — extra folder-name patterns to skip
- `ANTHROPIC_API_KEY` — enable `ask`

## Smoke test (no client needed)
```bash
python rag_mcp.py --selftest        # search_docs
python rag_mcp.py --selftest --ask  # also exercises ask() (costs one API call)
```
