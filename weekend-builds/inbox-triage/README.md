# AI Inbox Triage

**Wake up to a processed inbox: everything classified, replies drafted.**

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Try it on the bundled sample emails first (no account needed)
python3 triage.py --samples samples/

# Then your real inbox (IMAP; Gmail → use an app password)
python3 triage.py --imap imap.gmail.com --user you@gmail.com
```

Based on the *AI Inbox Triage* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds).

## What it does

```
unread emails (max 25, fetched with PEEK — they stay unread)
  → per-email Claude call with structured outputs:
      category · urgency · one-line summary · needs_reply · reply draft
  → triage board printed by category
  → drafts saved as drafts/*.eml with In-Reply-To headers
```

**Nothing is ever sent automatically.** Drafts are `.eml` files you open,
edit, and send from your own mail client — the human stays in the loop.
The drafting prompt is also forbidden from inventing commitments, amounts,
or dates; anything unknowable becomes a `[PLACEHOLDER]`.

Categories: `action-needed`, `waiting-decision`, `fyi`, `newsletter`,
`receipt`, `spamish`. Urgency `high` is reserved for real deadlines and
blocked people.

## Gmail setup

1. Enable IMAP (Gmail settings → Forwarding and POP/IMAP).
2. Create an [app password](https://support.google.com/accounts/answer/185833).
3. `python3 triage.py --imap imap.gmail.com --user you@gmail.com`

## Make it yours

- Schedule with cron at 06:30 and read the board with your coffee.
- Add your own categories to `TRIAGE_SCHEMA` + the system prompt.
- Auto-file: use `imaplib` `STORE`/`COPY` to label messages by category
  (start with `fyi`/`newsletter` only).
