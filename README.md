# feedprobe-status

Public uptime status page for FeedProbe, at `status.feedprobe.io`. Hosted on GitHub Pages — deliberately offsite from the VPS it monitors, so it stays up even if that box goes down entirely.

## How it works

- **`.github/workflows/check.yml`** runs `scripts/check.py` every 5 minutes (GitHub Actions' practical floor), checking each component in `COMPONENTS` and committing the result to `public/data/`.
- **`.github/workflows/deploy.yml`** deploys `public/` to Pages whenever it changes — no build step, everything in there is already the final static output.
- **`public/index.html` + `static/app.js`** render the page client-side by fetching the JSON files below. No framework, no build tooling.

## Data files (`public/data/`)

| File | Written by | Contents |
|---|---|---|
| `current.json` | check.py, every run | Latest status + response time per component |
| `history.json` | check.py, every run | Per-day up/checks counters, last 90 days — drives the uptime bar chart |
| `incidents.json` | check.py, every run | Currently-open incidents + up to 50 most recent closed ones |
| `notices.json` | **hand-edited** | Maintenance/incident announcements shown as a banner |

check.py commits on every run, even when nothing changed — that's intentional. The page shows "last checked" from `current.json`'s timestamp, so a visitor can tell the monitor itself is alive, not just that nothing's broken recently.

## Posting a maintenance notice

Edit `public/data/notices.json` directly and push. Format:

```json
[
  {
    "title": "Scheduled maintenance",
    "body": "Brief downtime expected 2026-07-20 02:00-03:00 UTC while we upgrade the VPS.",
    "until": "2026-07-20T03:00:00Z"
  }
]
```

`until` is optional — once it's in the past, the notice stops showing automatically. Omit it for a notice that stays up until you manually remove it.

## Adding or changing what's monitored

Edit `COMPONENTS` in `scripts/check.py`. Each entry needs a `name`, a `url`, and a `type`:

- `"ping"` — any 2xx/3xx HTTP response counts as up. Used for the landing page and the app's `/healthz`.
- `"heartbeat"` — fetches a JSON body with a `last_cycle_at` timestamp and treats the component as up only if that timestamp is no older than `HEARTBEAT_STALE_AFTER_SECONDS` (25 minutes, matching `feedprobe-app`'s 15-minute check interval plus a missed-cycle buffer). Used for the `worker` binary, which has no HTTP surface of its own — it can't be pinged directly, so it writes a heartbeat to the database on every completed check cycle, which the `api` process exposes read-only at `GET /api/v1/status/worker-heartbeat`. This is what lets the status page tell a silently-dead worker apart from one that's simply idle.

## Local testing

```bash
python3 scripts/check.py     # updates public/data/ against the real live endpoints
cd public && python3 -m http.server   # then open http://localhost:8000
```

## Setup (once per repo)

Repo Settings → Pages → Source: **GitHub Actions**. Set the custom domain to `status.feedprobe.io` there too (also baked into `public/CNAME`). Point `status.feedprobe.io`'s DNS at GitHub Pages the same way `feedprobe.io` is.
