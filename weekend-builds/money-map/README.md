# Money Map

**See where your money actually goes — without uploading your bank data anywhere.**

Export a CSV from your bank, run one script, get a markdown + HTML report with:

- Income / spent / net totals
- Spending by category (keyword rules, fully local)
- Spending by month
- **Recurring charges** detected across months, with ⚠️ flags on stable
  auto-billed subscriptions you may have forgotten (gym, Adobe, streaming…)

Based on the *Money Map* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds) (vol-3).
No API key, no packages, no network — Python 3.10+ standard library only.

## Run

```bash
python3 money_map.py sample-statement.csv
# → report.md + report.html in the current directory
```

Then open `report.html` in a browser.

### Your own bank export

```bash
python3 money_map.py my-bank.csv --out reports
```

- The script auto-detects `Date` / `Description` / `Amount` columns
  (also accepts `Transaction Date`, `Merchant`, `Payee`, `Value`…).
- Spending should be **negative**. If your bank exports spending as
  positive numbers, add `--flip`.
- Dates in `YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY`, `DD.MM.YYYY` all work.

## Tune it

- **Categories** — edit the `RULES` dict at the top of `money_map.py`.
  Anything unmatched lands in *Uncategorized*, and the script prints the
  merchant names it couldn't match so you know what to add.
- **Subscription detection** — a merchant charged in 2+ distinct months is
  recurring. If the amount barely varies (±5%) and the category is
  subscription-like, it gets the ⚠️ *likely forgotten* flag.
- **Merchant normalization** — `STARBUCKS #5567 SEATTLE` and
  `STARBUCKS #2210 PORTLAND` are grouped as one merchant.

## Privacy

Everything runs offline on your machine. The report footer says it because
it's true: *no data left this machine.*
