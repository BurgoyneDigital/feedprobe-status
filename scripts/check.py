#!/usr/bin/env python3
"""Checks each monitored FeedProbe component and updates the JSON files
the static status page reads. Stdlib only — no dependencies to install
in CI. Run on a schedule by .github/workflows/check.yml.

Writes three files under public/data/:
  current.json    latest status per component (small, always overwritten)
  history.json    per-day up/checks counters, last HISTORY_DAYS days
  incidents.json  open incidents (status currently down) + recent closed ones

Committing on every run (even when nothing changed) is intentional: the
status page shows "last checked" from current.json's timestamp, so
visitors can tell the monitor itself is alive, not just that nothing
has broken recently.

Two check types:
  "ping"      any 2xx/3xx HTTP response counts as up (landing page, app
              /healthz).
  "heartbeat" fetches a JSON body with a last_cycle_at timestamp and
              treats the component as up only if that timestamp is
              recent. Used for the worker binary, which has no HTTP
              surface of its own to ping directly -- a plain ping can't
              tell a silently-dead worker apart from a healthy one, so
              the worker's cron loop instead writes a heartbeat the api
              process exposes read-only.
"""
import datetime
import json
import pathlib
import time
import urllib.request

COMPONENTS = [
    {"name": "Landing page", "url": "https://feedprobe.io", "type": "ping"},
    {"name": "App", "url": "https://app.feedprobe.io/healthz", "type": "ping"},
    {"name": "Worker", "url": "https://app.feedprobe.io/api/v1/status/worker-heartbeat", "type": "heartbeat"},
]

DATA_DIR = pathlib.Path(__file__).resolve().parent.parent / "public" / "data"
TIMEOUT_SECONDS = 10
HISTORY_DAYS = 90
MAX_CLOSED_INCIDENTS = 50
# 15-minute check interval + one missed cycle + buffer. Matches
# feedprobe-app's CheckIntervalMinutes default (see internal/config).
HEARTBEAT_STALE_AFTER_SECONDS = 25 * 60


def check_ping(url: str) -> tuple[bool, int]:
    """Returns (ok, response_ms). ok is True for any 2xx/3xx response."""
    start = time.monotonic()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "feedprobe-status-check"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            ok = 200 <= resp.status < 400
    except Exception:
        ok = False
    return ok, round((time.monotonic() - start) * 1000)


def check_heartbeat(url: str) -> tuple[bool, int]:
    """Returns (ok, response_ms). ok is True if the endpoint returns a
    last_cycle_at timestamp no older than HEARTBEAT_STALE_AFTER_SECONDS."""
    start = time.monotonic()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "feedprobe-status-check"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read())
        last_cycle_at = data.get("last_cycle_at")
        if not last_cycle_at:
            ok = False
        else:
            last = datetime.datetime.fromisoformat(last_cycle_at.replace("Z", "+00:00"))
            age = (datetime.datetime.now(datetime.timezone.utc) - last).total_seconds()
            ok = age <= HEARTBEAT_STALE_AFTER_SECONDS
    except Exception:
        ok = False
    return ok, round((time.monotonic() - start) * 1000)


def check(component: dict) -> tuple[bool, int]:
    if component.get("type") == "heartbeat":
        return check_heartbeat(component["url"])
    return check_ping(component["url"])


def load(path: pathlib.Path, default):
    if path.exists():
        return json.loads(path.read_text())
    return default


def save(path: pathlib.Path, data) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n")


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    today = now.date().isoformat()

    history = load(DATA_DIR / "history.json", {})
    incidents = load(DATA_DIR / "incidents.json", {"open": {}, "closed": []})

    current = {"updated": now.isoformat(), "components": {}}

    for component in COMPONENTS:
        name = component["name"]
        ok, response_ms = check(component)
        status = "up" if ok else "down"
        current["components"][name] = {
            "status": status,
            "responseMs": response_ms,
            "url": component["url"],
        }

        # Daily uptime bucket, capped to a rolling window.
        day_list = history.setdefault(name, [])
        if not day_list or day_list[-1]["date"] != today:
            day_list.append({"date": today, "checks": 0, "up": 0})
        day_list[-1]["checks"] += 1
        day_list[-1]["up"] += 1 if ok else 0
        history[name] = day_list[-HISTORY_DAYS:]

        # Incident open/close: "open" already reflects the last time this
        # component was seen down, so a fresh down starts one and a fresh
        # up (while one is open) closes it — no separate transition check
        # needed against `previous`.
        if status == "down" and name not in incidents["open"]:
            incidents["open"][name] = {"start": now.isoformat()}
        elif status == "up" and name in incidents["open"]:
            opened = incidents["open"].pop(name)
            incidents["closed"].insert(
                0, {"name": name, "start": opened["start"], "end": now.isoformat()}
            )
            incidents["closed"] = incidents["closed"][:MAX_CLOSED_INCIDENTS]

    save(DATA_DIR / "current.json", current)
    save(DATA_DIR / "history.json", history)
    save(DATA_DIR / "incidents.json", incidents)

    for name, c in current["components"].items():
        print(f"{name}: {c['status']} ({c['responseMs']}ms)")


if __name__ == "__main__":
    main()
