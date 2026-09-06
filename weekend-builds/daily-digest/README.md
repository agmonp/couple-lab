# AI Daily Digest

**All your feeds, one ranked morning briefing.**

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# 1. Put your feeds in feeds.txt (RSS or Atom, one per line)
# 2. Run
python3 digest.py                 # → digests/2026-07-09.md
python3 digest.py --hours 48      # longer lookback
python3 digest.py --email you@example.com   # also send by email (SMTP app password)
```

Based on the *AI Daily Digest* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds).

## How it works

```
feeds.txt → stdlib RSS/Atom fetch+parse (last 24h, dead feeds skipped)
          → one Claude call: rank, merge duplicates, summarize
          → Top 5 (why it matters) + Also notable + what was skipped
          → digests/YYYY-MM-DD.md  (optional: email)
```

The interesting design choice: **ranking is the model's job, not the code's.**
The script just gathers; the editor prompt decides what deserves your
attention, merges duplicate coverage, and says what it dropped — so you can
tune the "editor" by editing one prompt string.

## Schedule it

```cron
0 7 * * * cd /path/to/daily-digest && /usr/bin/python3 digest.py >> cron.log 2>&1
```

For Gmail delivery use an [app password](https://support.google.com/accounts/answer/185833).
