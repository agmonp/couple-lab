# Offline Voice Journal

**Talk to your phone on the walk home; see your week's patterns — without your
voice ever leaving your machine.**

```bash
pip install faster-whisper       # local speech-to-text (CPU is fine)

# 1. Record voice memos on your phone, drop them into audio/
python3 journal.py transcribe    # → transcripts/YYYY-MM-DD-<name>.md (fully offline)

# 2. Look back
python3 journal.py review              # local stats: themes, recurring phrases, volume per day
python3 journal.py review --ai         # + a reflective summary via Claude (opt-in, the ONLY online step)
python3 journal.py review --days 30    # monthly look
```

Based on the *Offline Voice Journal* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds) (vol-3).

## Privacy model

| Step | Where it runs |
|---|---|
| Speech-to-text | On your machine (faster-whisper `small`, downloaded once) |
| Pattern stats (themes, phrases, volume) | On your machine, pure Python |
| `--ai` reflection | Claude API — **only if you ask**, and the flag says so out loud |

Transcripts are plain markdown files you own; entry dates come from the
audio files' timestamps. Works in Hebrew and English (both tokenized, both
stop-worded).

## What `review` shows

- Words-per-day (are you journaling more when stressed?)
- The words you kept coming back to
- Recurring phrases (bigrams that appear across days)
- With `--ai`: themes, mood trajectory, "you said you'd do X — did you?",
  one gentle suggestion, every claim grounded in your own quoted words

## Make it yours

- Bigger whisper model (`"medium"`) for noisy recordings.
- Add a mood lexicon to the local stats.
- A cron job that runs `review` every Sunday evening and saves it to a file.
