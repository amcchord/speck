type Item = Record<string, any>;
export function machinePresence(device: Item, now = Date.now() / 1000) {
  const t = device.telemetry || {};
  const observed = Date.parse(t.active_app?.observed_at || "") / 1000;
  const current = device.online && t.active_app && (!Number.isFinite(observed) || now - observed <= 75)
    ? t.active_app : null;
  const app = current || t.last_active_app || t.active_app;
  const state = !device.online ? "offline" : t.desktop?.state || (current ? "active" : "unknown");
  const desktop = ({
    active: "Active", disconnected: "Disconnected", unavailable: "Connected · locked or unavailable",
    no_session: "No signed-in session", no_desktop: "No graphical desktop", offline: "Machine offline",
    unknown: "Not reported",
  } as Record<string, string>)[state] || "Not reported";
  const users: string[] = Array.isArray(t.logged_in_users)
    ? t.logged_in_users.map((u: Item) => `${u.user}${u.state === "disconnected" ? " (disconnected)" : ""}`)
    : current?.user ? [current.user] : [];
  const userLabel = users.length ? [...new Set(users)].join(", ")
    : t.desktop?.sessions_available ? "No users signed in" : "Not reported";
  return {
    app, current: !!current, appLabel: current ? "Foreground app" : "Last app observed",
    title: app?.title || app?.process || "No app reported",
    table: app ? `${current ? "" : "Last: "}${app.process || app.title}` : "—",
    desktop, userLabel, userHeading: device.online ? "Signed-in user" : "Users at last report",
  };
}
