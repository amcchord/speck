// Pure helpers for the Network page, kept free of DOM and CSS for unit tests.
const DAY = 86400;

export function relative(ts: number | null | undefined, now = Date.now() / 1000) {
  if (!ts) return "never";
  const seconds = now - ts;
  const s = Math.abs(seconds);
  if (s < 90) return "just now";
  const text = s < 3600 ? Math.round(s / 60) + " min" : s < DAY ? Math.round(s / 3600) + " h" : Math.round(s / DAY) + " days";
  return seconds < 0 ? "in " + text : text + " ago";
}

export function parseRecordValues(text: string) {
  return text
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean);
}

export function expiresWithin(expires: string | undefined, days: number, now = Date.now()) {
  return Boolean(expires) && new Date(expires!).getTime() - now < days * DAY * 1000;
}

export function fqdn(domain: string, name: string) {
  return name === "@" ? domain : `${name}.${domain}`;
}
