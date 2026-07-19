// Renders the status page from the JSON files check.py writes. No
// framework, no build step — this is a static export like the rest of
// FeedProbe's public sites.

async function fetchJSON(path, fallback) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

function timeAgo(iso) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function formatDuration(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function renderOverview(current) {
  const components = Object.values(current.components || {});
  const allUp = components.length > 0 && components.every((c) => c.status === "up");
  const overview = document.getElementById("overview");
  const badge = document.getElementById("overview-badge");
  const heading = document.getElementById("overview-heading");
  const updated = document.getElementById("overview-updated");

  overview.classList.remove("ok", "down");
  overview.classList.add(allUp ? "ok" : "down");
  badge.classList.toggle("onair-down", !allUp);
  badge.lastChild.textContent = allUp ? "ON AIR" : "OFF AIR";
  heading.textContent = allUp
    ? "All systems on air"
    : "We're seeing an issue";
  updated.textContent = current.updated
    ? `Last checked ${timeAgo(current.updated)}`
    : "No check data yet";
}

function renderNotice(notices) {
  const container = document.getElementById("notice-container");
  const active = (notices || []).filter((n) => !n.until || new Date(n.until) > new Date());
  if (active.length === 0) return;
  container.innerHTML = active
    .map((n) => `<div class="notice-banner"><strong>${escapeHTML(n.title || "Notice")}:</strong> ${escapeHTML(n.body || "")}</div>`)
    .join("");
}

function renderBars(days) {
  // days: [{date, checks, up}], oldest first. Pad to a consistent width
  // so a brand-new component (few days of data) doesn't look broken.
  const bars = days
    .map((d) => {
      if (d.checks === 0) return { cls: "unknown", title: `${d.date}: no data` };
      const pct = (d.up / d.checks) * 100;
      const cls = pct >= 99.9 ? "up" : pct > 0 ? "partial" : "down";
      return { cls: cls === "up" ? "" : cls, title: `${d.date}: ${pct.toFixed(1)}% uptime` };
    })
    .map((b) => `<span class="bar ${b.cls}" title="${escapeHTML(b.title)}"></span>`)
    .join("");
  return `<div class="bars">${bars}</div>`;
}

function renderComponents(current, history) {
  const container = document.getElementById("components");
  const names = Object.keys(current.components || {});
  if (names.length === 0) {
    container.innerHTML = '<p class="hint">No components configured.</p>';
    return;
  }
  container.innerHTML = names
    .map((name) => {
      const c = current.components[name];
      const days = history[name] || [];
      const first = days[0]?.date;
      const last = days[days.length - 1]?.date;
      return `
        <div class="component">
          <div class="component-head">
            <span class="component-name">${escapeHTML(name)}</span>
            <span class="badge ${c.status === "up" ? "healthy" : "failing"}">${c.status === "up" ? "On air" : "Off air"}</span>
          </div>
          <div class="component-meta">${c.responseMs}ms response time</div>
          ${renderBars(days)}
          <div class="bars-caption"><span>${escapeHTML(first || "")}</span><span>${escapeHTML(last || "today")}</span></div>
        </div>`;
    })
    .join("");
}

function renderIncidents(incidents) {
  const list = document.getElementById("incident-list");
  const open = Object.entries(incidents.open || {}).map(([name, i]) => ({
    name, start: i.start, end: null,
  }));
  const closed = (incidents.closed || []).map((i) => ({ ...i, end: i.end }));
  const all = [...open, ...closed];

  if (all.length === 0) {
    list.innerHTML = '<li class="hint">No incidents recorded.</li>';
    return;
  }
  list.innerHTML = all
    .map((i) => {
      const when = new Date(i.start).toISOString().slice(0, 16).replace("T", " ");
      const duration = i.end ? formatDuration(i.start, i.end) : "ongoing";
      return `
        <li class="incident ${i.end ? "" : "open"}">
          <div class="incident-name">${escapeHTML(i.name)}</div>
          <div class="incident-time">${when} UTC — ${duration}</div>
        </li>`;
    })
    .join("");
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function main() {
  const [current, history, incidents, notices] = await Promise.all([
    fetchJSON("/data/current.json", { components: {} }),
    fetchJSON("/data/history.json", {}),
    fetchJSON("/data/incidents.json", { open: {}, closed: [] }),
    fetchJSON("/data/notices.json", []),
  ]);
  renderOverview(current);
  renderNotice(notices);
  renderComponents(current, history);
  renderIncidents(incidents);
}

main();
// Re-render periodically so a visitor watching the page sees fresh
// data without a manual reload — checks run every few minutes server
// side, so there's no point polling more often than that.
setInterval(main, 60000);
