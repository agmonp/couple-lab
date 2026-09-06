# Excalidraw Diagram Agent

**Describe any system → get a beautiful, editable diagram.**

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...

python3 diagram.py "web app: browser -> load balancer -> 2 api servers -> postgres + redis"
# → web-app.excalidraw

python3 diagram.py --demo    # sample diagram, no API call
```

Open the `.excalidraw` file at [excalidraw.com](https://excalidraw.com)
(File → Open) or with the VS Code Excalidraw extension, and keep editing —
every box, arrow, and label is a normal Excalidraw element.

Based on the *Excalidraw MCP Diagram Agent* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds).

## How it works

1. Claude extracts your description into a node/edge graph — via
   **structured outputs** (`output_config.format` with a JSON schema), so the
   graph always parses.
2. The script computes a layered left-to-right layout (longest-path layering).
3. Nodes are color-coded by kind (client / service / database / queue /
   external; databases render as ellipses) and written as Excalidraw elements.

Splitting "understand the system" (Claude) from "draw it" (deterministic
Python) is the trick — the LLM never has to emit Excalidraw's verbose element
format, so output is reliable.

## Make it yours

- Add kinds + colors in `COLORS` and the schema enum.
- Swap the layout function for grid/radial layouts.
- Feed it a whole README: `python3 diagram.py "$(cat ../my-service/README.md)"`
