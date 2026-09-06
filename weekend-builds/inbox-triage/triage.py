#!/usr/bin/env python3
"""AI Inbox Triage — wake up to a processed inbox with drafts ready to send.

    export ANTHROPIC_API_KEY=sk-ant-...

    # Real inbox (IMAP; for Gmail use an app password)
    python3 triage.py --imap imap.gmail.com --user you@gmail.com

    # Or try it on the bundled sample emails, no account needed
    python3 triage.py --samples samples/

Loop: read unread → classify each (category, urgency, needs-reply) → draft
replies for the ones that need them → print the triage board and save drafts
to drafts/*.eml (review + send from your mail client; nothing is sent
automatically).
"""

from __future__ import annotations

import argparse
import email
import email.policy
import getpass
import imaplib
import json
import re
import sys
from datetime import date
from email.message import EmailMessage
from pathlib import Path

import anthropic

MODEL = "claude-opus-4-8"
MAX_EMAILS = 25
DRAFTS_DIR = Path(__file__).parent / "drafts"

TRIAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "category": {"type": "string",
                     "enum": ["action-needed", "waiting-decision", "fyi",
                              "newsletter", "receipt", "spamish"]},
        "urgency": {"type": "string", "enum": ["high", "medium", "low"]},
        "summary": {"type": "string", "description": "One sentence, in the email's language"},
        "needs_reply": {"type": "boolean"},
        "reply_draft": {"type": "string",
                        "description": ("If needs_reply: a complete, ready-to-send reply in "
                                        "the sender's language, matching the thread's tone. "
                                        "Empty string otherwise.")},
    },
    "required": ["category", "urgency", "summary", "needs_reply", "reply_draft"],
    "additionalProperties": False,
}

SYSTEM = """You triage the user's email. Judge each message on its actual content:
- category: action-needed (user must do something), waiting-decision (user must
  decide/answer), fyi, newsletter, receipt, or spamish
- urgency: high only for real deadlines or blocked people
- needs_reply: true when a human reply is expected from the user
- reply_draft: when needed, write the reply the user would plausibly send —
  brief, warm, concrete. Never invent commitments, amounts, or dates that
  aren't in the email; leave [PLACEHOLDERS] for anything you can't know."""


def body_of(msg: email.message.EmailMessage) -> str:
    body = msg.get_body(preferencelist=("plain", "html"))
    if body is None:
        return ""
    text = body.get_content()
    if body.get_content_type() == "text/html":
        text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s{3,}", "\n", text).strip()[:6000]


def fetch_imap(host: str, user: str) -> list[dict]:
    password = getpass.getpass(f"IMAP password for {user} (app password): ")
    mail = imaplib.IMAP4_SSL(host)
    mail.login(user, password)
    mail.select("INBOX")
    _, data = mail.search(None, "UNSEEN")
    ids = data[0].split()[-MAX_EMAILS:]
    emails = []
    for msg_id in ids:
        _, msg_data = mail.fetch(msg_id, "(BODY.PEEK[])")  # PEEK: stays unread
        msg = email.message_from_bytes(msg_data[0][1], policy=email.policy.default)
        emails.append({"from": str(msg["From"]), "subject": str(msg["Subject"]),
                       "date": str(msg["Date"]), "body": body_of(msg),
                       "message_id": str(msg["Message-ID"] or "")})
    mail.logout()
    return emails


def fetch_samples(folder: Path) -> list[dict]:
    emails = []
    for path in sorted(folder.glob("*.eml")):
        msg = email.message_from_bytes(path.read_bytes(), policy=email.policy.default)
        emails.append({"from": str(msg["From"]), "subject": str(msg["Subject"]),
                       "date": str(msg["Date"]), "body": body_of(msg),
                       "message_id": str(msg["Message-ID"] or "")})
    return emails


def triage_one(client: anthropic.Anthropic, item: dict) -> dict:
    response = client.messages.create(
        model=MODEL,
        max_tokens=4096,
        thinking={"type": "adaptive"},
        system=SYSTEM,
        messages=[{"role": "user", "content":
                   f"From: {item['from']}\nSubject: {item['subject']}\n"
                   f"Date: {item['date']}\n\n{item['body']}"}],
        output_config={"format": {"type": "json_schema", "schema": TRIAGE_SCHEMA}},
    )
    return json.loads("".join(b.text for b in response.content if b.type == "text"))


def save_draft(item: dict, draft_text: str, index: int) -> Path:
    DRAFTS_DIR.mkdir(exist_ok=True)
    reply = EmailMessage()
    reply["To"] = item["from"]
    subject = str(item["subject"])
    reply["Subject"] = subject if subject.lower().startswith("re:") else f"Re: {subject}"
    if item["message_id"]:
        reply["In-Reply-To"] = item["message_id"]
    reply.set_content(draft_text)
    path = DRAFTS_DIR / f"{date.today()}-{index:02d}.eml"
    path.write_bytes(bytes(reply))
    return path


URGENCY_MARK = {"high": "!!", "medium": "! ", "low": "  "}


def main() -> None:
    parser = argparse.ArgumentParser(description="Triage the inbox, draft the replies.")
    parser.add_argument("--imap", help="IMAP host, e.g. imap.gmail.com")
    parser.add_argument("--user", help="IMAP username / email address")
    parser.add_argument("--samples", type=Path, help="Folder of .eml files instead of IMAP")
    args = parser.parse_args()

    if args.samples:
        emails = fetch_samples(args.samples)
    elif args.imap and args.user:
        emails = fetch_imap(args.imap, args.user)
    else:
        parser.error("either --imap + --user, or --samples folder/")
    if not emails:
        print("Inbox zero — nothing unread.")
        return

    client = anthropic.Anthropic()
    print(f"Triaging {len(emails)} emails...\n")
    board: dict[str, list] = {}
    drafts = 0
    for i, item in enumerate(emails, 1):
        try:
            verdict = triage_one(client, item)
        except anthropic.AuthenticationError:
            sys.exit("Set ANTHROPIC_API_KEY (get one at console.anthropic.com).")
        except anthropic.APIStatusError as exc:
            print(f"  [skip] {item['subject'][:50]} — API error {exc.status_code}")
            continue
        board.setdefault(verdict["category"], []).append((item, verdict))
        if verdict["needs_reply"] and verdict["reply_draft"].strip():
            drafts += 1
            path = save_draft(item, verdict["reply_draft"], drafts)
            verdict["draft_path"] = str(path)
        print(f"  [{i}/{len(emails)}] {verdict['category']:<16} {item['subject'][:60]}")

    print(f"\n{'=' * 70}\nTRIAGE BOARD — {date.today()}\n")
    for category in ("action-needed", "waiting-decision", "fyi",
                     "newsletter", "receipt", "spamish"):
        entries = board.get(category, [])
        if not entries:
            continue
        print(f"── {category.upper()} ({len(entries)})")
        for item, verdict in sorted(entries, key=lambda e: e[1]["urgency"]):
            print(f"  {URGENCY_MARK[verdict['urgency']]} {item['subject'][:58]}")
            print(f"     {verdict['summary']}")
            if verdict.get("draft_path"):
                print(f"     ✉ draft ready: {verdict['draft_path']}")
        print()
    print(f"{drafts} reply draft(s) in {DRAFTS_DIR}/ — review and send from your mail client.")


if __name__ == "__main__":
    main()
