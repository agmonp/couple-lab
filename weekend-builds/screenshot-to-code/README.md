# Screenshot to Code

**Photo of any UI → a working React component (or standalone HTML page).**

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...

python3 screenshot2code.py design.png                     # → Design.tsx
python3 screenshot2code.py sketch.jpg --format html       # → sketch.html (open in browser)
python3 screenshot2code.py app.png --notes "dark theme, mobile-first"
```

Works on real screenshots, Figma exports, and even whiteboard photos.
Based on the *Screenshot to Code* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds).

## How it works

The image goes to Claude (`claude-opus-4-8` — high-resolution vision, up to
2576px on the long edge) with a strict prompt: one self-contained file,
matching layout/spacing/colors, realistic placeholder content, working local
state for interactive elements. The script extracts the code block and writes
it next to the image.

## Tips

- `--format html` gives you a file you can double-click to preview instantly;
  `react` is for dropping into an existing app.
- Iterate with `--notes`: "make the sidebar collapsible", "use CSS grid",
  "brand color is #0E7C66".
- Higher-resolution input = better fidelity. Don't downscale screenshots.
