# Decision Simulator

**Facing a big decision? Simulate 10,000 futures instead of arguing about one.**

```bash
python3 simulate.py sample-decision.json          # fully local, no API key needed
python3 simulate.py my-decision.json --runs 50000 --seed 42
python3 simulate.py my-decision.json --ai         # + Claude interprets & attacks your assumptions
```

Based on the *Decision Simulator* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds) (vol-3).
The Monte Carlo core is pure standard-library Python; Claude is an optional
layer on top.

## How to model a decision

Copy `sample-decision.json`. Each option gets weighted factors, and each
factor gets a **range** — `min` / `mode` (most likely) / `max` — because the
whole point is that you don't know the single number:

```json
{"name": "stress & hours", "min": -80, "mode": -45, "max": -10, "weight": 0.20}
```

Values are subjective utility points (negatives allowed); weights are how much
*you* care. Every run draws each factor from a triangular distribution and
sums the weighted result.

## What you get

- Median / p10 / p90 / stdev per option — the **downside you'd be accepting**
  (p10) is usually more decision-relevant than the average
- ASCII histograms on a shared scale, so overlap is visible
- For two options: `P(A beats B)` head-to-head
- With `--ai`: a plain-language read of the distributions, **which single
  assumption would flip the outcome if wrong**, and what cheap information
  would reduce the most uncertainty. It never tells you what to choose.

## Make it yours

- Correlated factors (startup success drives both money *and* stress)? Draw a
  shared "scenario" variable first and condition factors on it.
- Add a third option — the report handles any number (head-to-head shows for two).
