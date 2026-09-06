# Content Repurposer

**Write once → publish everywhere, still sounding like you.**

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...

python3 repurpose.py post.md
python3 repurpose.py post.md --platforms twitter,linkedin,youtube
python3 repurpose.py post.md --voice samples/     # folder of your past writing
```

Outputs land in `out/` — one file per platform, plus the distillation itself.

Supported platforms: `twitter` (thread), `linkedin`, `newsletter`,
`instagram` (caption + visual suggestion), `youtube` (short script).

Based on the *Content Repurposer* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds).

## The pattern: prompt chaining

The naive approach — "rewrite this post for Twitter" × 5 — drifts: each
version re-interprets the original differently. Instead:

```
post.md ──► DISTILL: core claims + evidence + voice fingerprint (one call)
                 │
                 ├──► TRANSFORM per platform, from the distillation
                 └──► every version shares the same facts and the same voice
```

The transformer is forbidden from inventing facts not in the distillation,
and must follow the voice fingerprint — pass `--voice` with a folder of your
published writing to make that fingerprint yours rather than the post's.

## Make it yours

- Add platforms: one entry in the `PLATFORMS` dict is all it takes.
- Edit the rules to match what actually works for your audience.
- Pipe in transcripts: a podcast transcript in, a week of content out.
