#!/usr/bin/env python3
"""AI Daily Digest — your feeds, summarized into one morning briefing.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 digest.py                       # reads feeds.txt → digests/YYYY-MM-DD.md
    python3 digest.py --email you@example.com --smtp smtp.gmail.com:587

Pipeline: fetch RSS/Atom feeds (stdlib only) → collect the last 24h of items
→ one Claude call ranks and summarizes → markdown digest (optionally emailed).

Schedule it: cron `0 7 * * * cd .../daily-digest && python3 digest.py`
"""

from __future__ import annotations

import argparse
import getpass
import re
import smtplib
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.mime.text import MIMEText
from email.utils import parsedate_to_datetime
from pathlib import Path

import anthropic

MODEL = "claude-opus-4-8"
HERE = Path(__file__).parent
FEEDS_FILE = HERE / "feeds.txt"
DIGESTS_DIR = HERE / "digests"
MAX_ITEMS_PER_FEED = 15

SYSTEM = """You are an editor writing a personal morning digest.
From the feed items provided, produce a markdown briefing:

1. **Top 5** — the items most worth the reader's time today, each with a
   2-3 sentence summary, why it matters, and the link.
2. **Also notable** — up to 8 one-liners with links.
3. **Skip list** — one line naming themes you left out and why.

Rank by significance and novelty, not by feed order. Merge duplicate stories.
Keep the tone direct and personal, not press-release."""


def parse_feed(url: str, since: datetime) -> list[dict]:
    request = urllib.request.Request(url, headers={"User-Agent": "daily-digest/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        root = ET.fromstring(response.read())

    ns = {"atom": "http://www.w3.org/2005/Atom"}
    items = []
    # RSS 2.0
    for item in root.iter("item"):
        entry = {
            "title": (item.findtext("title") or "").strip(),
            "link": (item.findtext("link") or "").strip(),
            "summary": re.sub(r"<[^>]+>", "", item.findtext("description") or "")[:500],
        }
        pub = item.findtext("pubDate")
        try:
            if pub and parsedate_to_datetime(pub) < since:
                continue
        except (TypeError, ValueError):
            pass
        items.append(entry)
    # Atom
    for entry_el in root.findall("atom:entry", ns):
        link_el = entry_el.find("atom:link", ns)
        entry = {
            "title": (entry_el.findtext("atom:title", namespaces=ns) or "").strip(),
            "link": link_el.get("href", "") if link_el is not None else "",
            "summary": re.sub(r"<[^>]+>", "",
                              entry_el.findtext("atom:summary", namespaces=ns) or "")[:500],
        }
        updated = entry_el.findtext("atom:updated", namespaces=ns)
        try:
            if updated and datetime.fromisoformat(updated.replace("Z", "+00:00")) < since:
                continue
        except ValueError:
            pass
        items.append(entry)
    return items[:MAX_ITEMS_PER_FEED]


def collect(feeds: list[str], hours: int) -> str:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    sections = []
    for url in feeds:
        try:
            items = parse_feed(url, since)
            print(f"  {url}: {len(items)} items")
        except Exception as exc:  # a dead feed shouldn't kill the digest
            print(f"  {url}: FAILED ({exc})")
            continue
        lines = [f"- {i['title']} | {i['link']}\n  {i['summary']}" for i in items]
        sections.append(f"## Feed: {url}\n" + "\n".join(lines))
    if not sections:
        sys.exit("No feed items collected — check feeds.txt and your network.")
    return "\n\n".join(sections)


def summarize(raw_items: str) -> str:
    client = anthropic.Anthropic()
    try:
        with client.messages.stream(
            model=MODEL,
            max_tokens=8192,
            thinking={"type": "adaptive"},
            system=SYSTEM,
            messages=[{"role": "user",
                       "content": f"Feed items from the last day:\n\n{raw_items}"}],
        ) as stream:
            for text in stream.text_stream:
                print(text, end="", flush=True)
            message = stream.get_final_message()
    except anthropic.AuthenticationError:
        sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
    except anthropic.APIStatusError as exc:
        sys.exit(f"API error {exc.status_code}: {exc.message}")
    return "".join(b.text for b in message.content if b.type == "text")


def send_email(digest: str, to_addr: str, smtp_spec: str) -> None:
    host, _, port = smtp_spec.partition(":")
    user = input(f"SMTP user for {host}: ").strip()
    password = getpass.getpass("SMTP password (app password): ")
    msg = MIMEText(digest, "plain", "utf-8")
    msg["Subject"] = f"Daily digest — {date.today():%A %d %B}"
    msg["From"], msg["To"] = user, to_addr
    with smtplib.SMTP(host, int(port or 587)) as server:
        server.starttls()
        server.login(user, password)
        server.send_message(msg)
    print(f"Emailed to {to_addr}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Feeds → one morning digest.")
    parser.add_argument("--hours", type=int, default=24, help="Lookback window")
    parser.add_argument("--email", help="Send the digest to this address")
    parser.add_argument("--smtp", default="smtp.gmail.com:587", help="SMTP host:port")
    args = parser.parse_args()

    if not FEEDS_FILE.exists():
        sys.exit(f"Create {FEEDS_FILE} with one feed URL per line ('#' for comments).")
    feeds = [l.strip() for l in FEEDS_FILE.read_text().splitlines()
             if l.strip() and not l.startswith("#")]

    print(f"Fetching {len(feeds)} feeds...")
    raw = collect(feeds, args.hours)
    print(f"\n{'=' * 60}\n")
    digest = summarize(raw)

    DIGESTS_DIR.mkdir(exist_ok=True)
    out = DIGESTS_DIR / f"{date.today()}.md"
    out.write_text(f"# Daily digest — {date.today():%A %d %B %Y}\n\n{digest}\n",
                   encoding="utf-8")
    print(f"\n\nSaved {out}")
    if args.email:
        send_email(digest, args.email, args.smtp)


if __name__ == "__main__":
    main()
