# Ambient Life Dashboard

**A calm surface you glance at — not another app to open.**

Put an old tablet or a second monitor on your desk and give it one job:
show today's calendar, the weather, and your tasks as a quiet animated
scene. The sky's color follows the real time of day — sun arcs across it
by day, moon and stars by night, clouds drift slowly. Data refreshes every
five minutes; the sky repaints every minute.

Based on the *Ambient Life Dashboard* idea from
[kju4q/ai-weekend-builds](https://github.com/kju4q/ai-weekend-builds) (vol-3).
Python 3.10+ standard library only — no packages, no accounts, no API keys
(weather comes from the free, keyless [Open-Meteo](https://open-meteo.com) API).

## Run

```bash
python3 server.py
# → open http://localhost:8500
```

That's it. You get the sample calendar, sample tasks, and live weather for
New York.

## Personalize

Everything is configured with environment variables and two local files:

```bash
LAT=32.08 LON=34.78 ICS_FILE=~/my-calendar.ics python3 server.py
```

| What | How |
|---|---|
| Calendar | Export an `.ics` from Google Calendar / Apple Calendar / Outlook and point `ICS_FILE` at it. Events dated today (and yearly repeats like birthdays) are shown. |
| Weather | Set `LAT` / `LON` to your coordinates (e.g. Tel Aviv: `32.08` / `34.78`). |
| Tasks | Edit `tasks.json` — a list of `{ "text": "...", "done": false }`. |
| Port | `PORT=9000 python3 server.py` |

## Deploy as an ambient display

1. Run the server on any machine on your network
   (`http://<machine-ip>:8500` from the tablet).
2. Open it full-screen in the tablet's browser
   (iOS: Add to Home Screen · Android: Chrome → Add to Home screen).
3. Disable the screen timeout while charging.

## Design notes

The calm comes from space, few elements, and slow motion: no borders, no
boxes, at most five items per list, transitions measured in minutes. If
you add features, keep subtracting pixels.
