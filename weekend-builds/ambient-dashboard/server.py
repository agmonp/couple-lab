#!/usr/bin/env python3
"""Ambient Life Dashboard — a calm display for an old tablet or second screen.

Serves a single animated page showing today's calendar, the weather, and
your tasks. Python standard library only.

    python3 server.py          # then open http://localhost:8500

Environment variables:
    ICS_FILE  path to a calendar .ics file   (default: sample.ics)
    TASKS     path to a tasks JSON file      (default: tasks.json)
    LAT, LON  coordinates for weather        (default: New York)
    PORT      server port                    (default: 8500)
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import date, datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

HERE = Path(__file__).parent
ICS_FILE = Path(os.environ.get("ICS_FILE", HERE / "sample.ics"))
TASKS_FILE = Path(os.environ.get("TASKS", HERE / "tasks.json"))
LAT = os.environ.get("LAT", "40.71")
LON = os.environ.get("LON", "-74.01")
PORT = int(os.environ.get("PORT", "8500"))

WEATHER_URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}"
    "&current=temperature_2m,weather_code"
    "&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1"
)

# Open-Meteo WMO weather codes → short label + emoji-free glyph handled in CSS
WEATHER_CODES = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain",
    67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
    77: "Snow", 80: "Showers", 81: "Showers", 82: "Heavy showers",
    85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm",
    96: "Thunderstorm", 99: "Thunderstorm",
}


def todays_events() -> list[dict]:
    """Minimal .ics parser: today's VEVENTs with DTSTART + SUMMARY.

    Supports yearly-repeating all-day events (RRULE:FREQ=YEARLY) so
    birthdays in the sample stay relevant; everything else matches by date.
    """
    if not ICS_FILE.exists():
        return []
    text = ICS_FILE.read_text(encoding="utf-8")
    today = date.today()
    events = []
    for block in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", text, re.S):
        dtstart = re.search(r"DTSTART[^:]*:(\d{8})(?:T(\d{4}))?", block)
        summary = re.search(r"SUMMARY:(.+)", block)
        if not dtstart or not summary:
            continue
        start = datetime.strptime(dtstart.group(1), "%Y%m%d").date()
        yearly = "FREQ=YEARLY" in block
        matches_today = start == today or (
            yearly and (start.month, start.day) == (today.month, today.day)
        )
        if not matches_today:
            continue
        time_part = dtstart.group(2)
        events.append({
            "time": f"{time_part[:2]}:{time_part[2:]}" if time_part else "",
            "summary": summary.group(1).strip(),
        })
    return sorted(events, key=lambda e: e["time"])


def load_tasks() -> list[dict]:
    if not TASKS_FILE.exists():
        return []
    try:
        return json.loads(TASKS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return [{"text": f"Could not parse {TASKS_FILE.name}", "done": False}]


def fetch_weather() -> dict:
    try:
        with urllib.request.urlopen(WEATHER_URL, timeout=6) as resp:
            data = json.load(resp)
        current = data["current"]
        daily = data["daily"]
        return {
            "ok": True,
            "temperature": round(current["temperature_2m"]),
            "label": WEATHER_CODES.get(current["weather_code"], "—"),
            "code": current["weather_code"],
            "high": round(daily["temperature_2m_max"][0]),
            "low": round(daily["temperature_2m_min"][0]),
        }
    except Exception as exc:  # offline / API down: the scene still renders
        return {"ok": False, "error": str(exc)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/data":
            payload = json.dumps({
                "events": todays_events(),
                "tasks": load_tasks(),
                "weather": fetch_weather(),
                "generated_at": datetime.now().isoformat(timespec="seconds"),
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def log_message(self, fmt, *args):  # keep the terminal calm too
        pass


if __name__ == "__main__":
    print(f"Ambient Life Dashboard → http://localhost:{PORT}")
    print(f"calendar: {ICS_FILE.name} · tasks: {TASKS_FILE.name} · lat/lon: {LAT},{LON}")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
