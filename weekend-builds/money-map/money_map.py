#!/usr/bin/env python3
"""Money Map — analyze a bank-statement CSV locally.

Parses a CSV export from your bank, categorizes every transaction with
keyword rules, detects recurring charges (subscriptions), flags the ones
that look forgotten, and writes a markdown + HTML report.

Your financial data never leaves the machine — not one byte.

Usage:
    python money_map.py sample-statement.csv
    python money_map.py my-bank.csv --out reports --flip
"""

from __future__ import annotations

import argparse
import csv
import html
import re
import statistics
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Categorization rules — tune these for your own bank's merchant names.
# First keyword (case-insensitive substring) that matches wins.
# ---------------------------------------------------------------------------
RULES: dict[str, str] = {
    "payroll": "Income",
    "salary": "Income",
    "deposit": "Income",
    "whole foods": "Groceries",
    "trader joe": "Groceries",
    "safeway": "Groceries",
    "supermarket": "Groceries",
    "grocery": "Groceries",
    "starbucks": "Coffee & Cafes",
    "coffee": "Coffee & Cafes",
    "cafe": "Coffee & Cafes",
    "uber eats": "Restaurants",
    "doordash": "Restaurants",
    "restaurant": "Restaurants",
    "pizza": "Restaurants",
    "sushi": "Restaurants",
    "netflix": "Subscriptions",
    "spotify": "Subscriptions",
    "adobe": "Subscriptions",
    "icloud": "Subscriptions",
    "youtube premium": "Subscriptions",
    "audible": "Subscriptions",
    "gym": "Fitness",
    "fitness": "Fitness",
    "uber": "Transport",
    "lyft": "Transport",
    "shell": "Transport",
    "chevron": "Transport",
    "parking": "Transport",
    "electric": "Utilities",
    "water dept": "Utilities",
    "internet": "Utilities",
    "comcast": "Utilities",
    "verizon": "Utilities",
    "t-mobile": "Utilities",
    "rent": "Housing",
    "landlord": "Housing",
    "mortgage": "Housing",
    "amazon": "Shopping",
    "target": "Shopping",
    "walmart": "Shopping",
    "pharmacy": "Health",
    "cvs": "Health",
    "walgreens": "Health",
    "dental": "Health",
    "cinema": "Entertainment",
    "steam": "Entertainment",
    "ticketmaster": "Entertainment",
}

# Categories where a stable recurring charge is a classic "forgotten" candidate.
SUBSCRIPTION_LIKE = {"Subscriptions", "Fitness", "Entertainment"}


def categorize(description: str) -> str:
    d = description.lower()
    for keyword, category in RULES.items():
        if keyword in d:
            return category
    return "Uncategorized"


def normalize_merchant(description: str) -> str:
    """Collapse 'STARBUCKS #5567 SEATTLE' and 'STARBUCKS #2210' into 'STARBUCKS'."""
    d = description.upper()
    d = re.sub(r"#\d+", "", d)          # store numbers
    d = re.sub(r"\b\d{2,}\b", "", d)     # long digit runs (ids, dates)
    d = re.sub(r"[*\-_/]+", " ", d)
    d = re.sub(r"\s{2,}", " ", d).strip()
    # Keep the first three words — enough to identify the merchant.
    return " ".join(d.split()[:3])


DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m/%d/%y", "%d.%m.%Y", "%Y/%m/%d")


def parse_date(raw: str) -> datetime:
    raw = raw.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    raise ValueError(f"Unrecognized date: {raw!r} (add its format to DATE_FORMATS)")


def parse_amount(raw: str) -> float:
    cleaned = raw.strip().replace(",", "").replace("$", "").replace("₪", "")
    if cleaned.startswith("(") and cleaned.endswith(")"):  # accounting negatives
        cleaned = "-" + cleaned[1:-1]
    return float(cleaned)


def load_transactions(path: Path, flip: bool) -> list[dict]:
    """Read the CSV, locating date/description/amount columns by header name."""
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            sys.exit("CSV appears to be empty.")
        headers = {h.lower().strip(): h for h in reader.fieldnames}

        def find(*names: str) -> str:
            for n in names:
                if n in headers:
                    return headers[n]
            sys.exit(f"Could not find a {names[0]!r} column. Headers: {reader.fieldnames}")

        date_col = find("date", "transaction date", "posted date")
        desc_col = find("description", "merchant", "details", "payee")
        amount_col = find("amount", "value", "sum")

        transactions = []
        for row in reader:
            if not row.get(date_col) or not row.get(amount_col):
                continue
            amount = parse_amount(row[amount_col])
            if flip:
                amount = -amount
            transactions.append({
                "date": parse_date(row[date_col]),
                "description": row[desc_col].strip(),
                "amount": amount,
                "category": categorize(row[desc_col]),
                "merchant": normalize_merchant(row[desc_col]),
            })
    if not transactions:
        sys.exit("No transactions parsed from the CSV.")
    return sorted(transactions, key=lambda t: t["date"])


def detect_recurring(transactions: list[dict]) -> list[dict]:
    """A merchant charged in 2+ distinct months is recurring.

    A recurring charge whose amount barely varies (auto-billing) in a
    subscription-like category gets the ⚠️ likely-forgotten flag.
    """
    by_merchant: dict[str, list[dict]] = defaultdict(list)
    for t in transactions:
        if t["amount"] < 0:
            by_merchant[t["merchant"]].append(t)

    recurring = []
    for merchant, charges in by_merchant.items():
        months = {t["date"].strftime("%Y-%m") for t in charges}
        if len(months) < 2:
            continue
        amounts = [-t["amount"] for t in charges]
        mean = statistics.mean(amounts)
        spread = (max(amounts) - min(amounts)) / mean if mean else 0
        stable = spread < 0.05
        category = charges[0]["category"]
        recurring.append({
            "merchant": merchant,
            "category": category,
            "months": sorted(months),
            "avg_amount": mean,
            "yearly_cost": mean * 12,
            "stable": stable,
            "likely_forgotten": stable and category in SUBSCRIPTION_LIKE,
        })
    return sorted(recurring, key=lambda r: r["avg_amount"], reverse=True)


def summarize(transactions: list[dict]) -> dict:
    income = sum(t["amount"] for t in transactions if t["amount"] > 0)
    spent = -sum(t["amount"] for t in transactions if t["amount"] < 0)
    by_category: dict[str, float] = defaultdict(float)
    for t in transactions:
        if t["amount"] < 0:
            by_category[t["category"]] += -t["amount"]
    by_month: dict[str, float] = defaultdict(float)
    for t in transactions:
        if t["amount"] < 0:
            by_month[t["date"].strftime("%Y-%m")] += -t["amount"]
    return {
        "income": income,
        "spent": spent,
        "net": income - spent,
        "by_category": dict(sorted(by_category.items(), key=lambda kv: kv[1], reverse=True)),
        "by_month": dict(sorted(by_month.items())),
        "start": transactions[0]["date"],
        "end": transactions[-1]["date"],
        "count": len(transactions),
    }


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

def ascii_bar(value: float, max_value: float, width: int = 30) -> str:
    filled = int(round(width * value / max_value)) if max_value else 0
    return "█" * filled + "░" * (width - filled)


def render_markdown(summary: dict, recurring: list[dict]) -> str:
    lines = [
        "# Money Map report",
        "",
        f"*{summary['start']:%Y-%m-%d} → {summary['end']:%Y-%m-%d} · {summary['count']} transactions*",
        "",
        f"| Income | Spent | Net |",
        f"|---|---|---|",
        f"| {summary['income']:,.2f} | {summary['spent']:,.2f} | {summary['net']:+,.2f} |",
        "",
        "## Spending by category",
        "",
        "```",
    ]
    top = max(summary["by_category"].values(), default=0)
    for cat, total in summary["by_category"].items():
        lines.append(f"{cat:<16} {ascii_bar(total, top)} {total:>10,.2f}")
    lines += ["```", "", "## Spending by month", "", "```"]
    top_m = max(summary["by_month"].values(), default=0)
    for month, total in summary["by_month"].items():
        lines.append(f"{month:<16} {ascii_bar(total, top_m)} {total:>10,.2f}")
    lines += ["```", "", "## Recurring charges", ""]
    if not recurring:
        lines.append("No recurring charges detected.")
    for r in recurring:
        flag = " ⚠️ **likely forgotten — still using this?**" if r["likely_forgotten"] else ""
        lines.append(
            f"- **{r['merchant'].title()}** ({r['category']}) — "
            f"{r['avg_amount']:,.2f}/charge across {len(r['months'])} months "
            f"≈ {r['yearly_cost']:,.2f}/year{flag}"
        )
    lines += [
        "",
        "---",
        "*Generated locally by Money Map. No data left this machine.*",
        "",
    ]
    return "\n".join(lines)


def render_html(summary: dict, recurring: list[dict]) -> str:
    def bar_row(label: str, value: float, max_value: float, color: str) -> str:
        pct = 100 * value / max_value if max_value else 0
        return (
            f'<div class="row"><span class="label">{html.escape(label)}</span>'
            f'<span class="track"><span class="bar" style="width:{pct:.1f}%;background:{color}"></span></span>'
            f'<span class="value">{value:,.2f}</span></div>'
        )

    palette = ["#5B8DEF", "#5BB98C", "#E5A54B", "#D4699B", "#8A7CD8",
               "#4FB3C6", "#C97B5D", "#7E9C56", "#B36FB3", "#6C87A0"]
    top = max(summary["by_category"].values(), default=0)
    category_rows = "".join(
        bar_row(cat, total, top, palette[i % len(palette)])
        for i, (cat, total) in enumerate(summary["by_category"].items())
    )
    top_m = max(summary["by_month"].values(), default=0)
    month_rows = "".join(
        bar_row(month, total, top_m, "#5B8DEF")
        for month, total in summary["by_month"].items()
    )
    recurring_rows = "".join(
        f'<li class="{"flag" if r["likely_forgotten"] else ""}">'
        f'<strong>{html.escape(r["merchant"].title())}</strong> '
        f'({html.escape(r["category"])}) — {r["avg_amount"]:,.2f}/charge, '
        f'{len(r["months"])} months, ≈ {r["yearly_cost"]:,.2f}/year'
        f'{" ⚠️ likely forgotten — still using this?" if r["likely_forgotten"] else ""}</li>'
        for r in recurring
    ) or "<li>No recurring charges detected.</li>"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Money Map report</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ font: 15px/1.5 system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; }}
  h1 {{ font-size: 1.6rem; }} h2 {{ margin-top: 2rem; font-size: 1.15rem; }}
  .totals {{ display: flex; gap: 1rem; flex-wrap: wrap; }}
  .card {{ flex: 1 1 140px; border-radius: 12px; padding: .8rem 1rem; background: rgba(125,125,125,.12); }}
  .card b {{ display: block; font-size: 1.3rem; }}
  .row {{ display: flex; align-items: center; gap: .6rem; margin: .35rem 0; }}
  .label {{ flex: 0 0 9.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }}
  .track {{ flex: 1; height: 14px; border-radius: 7px; background: rgba(125,125,125,.15); overflow: hidden; }}
  .bar {{ display: block; height: 100%; border-radius: 7px; }}
  .value {{ flex: 0 0 6.5rem; text-align: right; font-variant-numeric: tabular-nums; }}
  li.flag {{ background: rgba(229,165,75,.18); border-radius: 8px; padding: .25rem .5rem; list-style-position: inside; }}
  ul {{ padding-left: 1.1rem; }} li {{ margin: .35rem 0; }}
  footer {{ margin-top: 2.5rem; opacity: .65; font-size: .85rem; }}
</style>
</head>
<body>
<h1>Money Map report</h1>
<p>{summary['start']:%Y-%m-%d} → {summary['end']:%Y-%m-%d} · {summary['count']} transactions</p>
<div class="totals">
  <div class="card">Income <b>{summary['income']:,.2f}</b></div>
  <div class="card">Spent <b>{summary['spent']:,.2f}</b></div>
  <div class="card">Net <b>{summary['net']:+,.2f}</b></div>
</div>
<h2>Spending by category</h2>
{category_rows}
<h2>Spending by month</h2>
{month_rows}
<h2>Recurring charges</h2>
<ul>{recurring_rows}</ul>
<footer>Generated locally by Money Map. No data left this machine.</footer>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze a bank-statement CSV locally.")
    parser.add_argument("csv_file", type=Path, help="Bank statement CSV (date, description, amount)")
    parser.add_argument("--out", type=Path, default=Path("."), help="Output directory for reports")
    parser.add_argument("--flip", action="store_true",
                        help="Flip amount signs (for banks that export spending as positive)")
    args = parser.parse_args()

    transactions = load_transactions(args.csv_file, flip=args.flip)
    summary = summarize(transactions)
    recurring = detect_recurring(transactions)

    args.out.mkdir(parents=True, exist_ok=True)
    md_path = args.out / "report.md"
    html_path = args.out / "report.html"
    md_path.write_text(render_markdown(summary, recurring), encoding="utf-8")
    html_path.write_text(render_html(summary, recurring), encoding="utf-8")

    uncategorized = [t for t in transactions if t["category"] == "Uncategorized"]
    print(f"Parsed {summary['count']} transactions "
          f"({summary['start']:%Y-%m-%d} → {summary['end']:%Y-%m-%d})")
    print(f"Income {summary['income']:,.2f} · Spent {summary['spent']:,.2f} · Net {summary['net']:+,.2f}")
    print(f"Recurring charges: {len(recurring)} "
          f"({sum(1 for r in recurring if r['likely_forgotten'])} flagged ⚠️)")
    if uncategorized:
        print(f"{len(uncategorized)} uncategorized — add keywords to RULES, e.g.: "
              + ", ".join(sorted({t['merchant'] for t in uncategorized})[:5]))
    print(f"Reports written: {md_path} and {html_path}")


if __name__ == "__main__":
    main()
