// A small, consistent icon set. Stroke geometry is independent of installed fonts.
const paths = {
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 4v16M16 4v16"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  sort: '<path d="M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4"/>',
  sortUp: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  sortDown: '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  grip: '<path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" stroke-width="3"/>',
  network: '<rect x="3" y="3" width="18" height="6" rx="1"/><rect x="3" y="15" width="18" height="6" rx="1"/><path d="M7 6h.01M7 18h.01M12 9v6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  laptop: '<rect x="4" y="3" width="16" height="13" rx="2"/><path d="m4 16-2 5h20l-2-5M10 18h4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  patch: '<path d="M12 3 4 6v6c0 4 8 9 8 9s8-5 8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  package: '<path d="m12 3 9 5v9l-9 5-9-5V8Zm-9 5 9 5 9-5M12 13v9M7 5.8l9 5"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  terminal: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="m6 8 4 4-4 4m7 0h5"/>',
  spark: '<path d="M12 2v5m0 10v5M2 12h5m10 0h5M5 5l3.5 3.5m7 7L19 19M5 19l3.5-3.5m7-7L19 5"/><circle cx="12" cy="12" r="1"/>',
  fleet:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  recovery: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  slide: '<path d="m6 6 15 0-3 12H3Z"/><path d="M8 10h8M7 14h8"/>',
  activity: '<path d="M2 12h4l3-7 6 14 3-7h4"/>',
  alerts: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
  history: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  settings:
    '<path d="M5 3v18M12 3v18M19 3v18"/><rect x="2" y="6" width="6" height="4" rx="1" fill="currentColor"/><rect x="9" y="14" width="6" height="4" rx="1" fill="currentColor"/><rect x="16" y="7" width="6" height="4" rx="1" fill="currentColor"/>',
  windows:
    '<path fill="currentColor" stroke="none" d="M3 3h8v8H3Zm10 0h8v8h-8ZM3 13h8v8H3Zm10 0h8v8h-8Z"/>',
  linux:
    '<path d="M8 9V6a4 4 0 0 1 8 0v3l3 7-3 4H8l-3-4Z" fill="currentColor"/><ellipse cx="12" cy="14" rx="4" ry="5" fill="var(--white)" stroke="none"/><circle cx="10.5" cy="6" r=".7" fill="var(--white)" stroke="none"/><circle cx="13.5" cy="6" r=".7" fill="var(--white)" stroke="none"/><path d="m10 8 2 2 2-2M5 18l-2 3h6l1-2m9-1 2 3h-6l-1-2"/>',
  code: '<path d="m7 6-5 6 5 6m10-12 5 6-5 6M14 3l-4 18"/>',
  refresh:
    '<path d="M20 7a9 9 0 0 0-15-1L2 9m0-6v6h6m-4 8a9 9 0 0 0 15 1l3-3m0 6v-6h-6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  logout: '<path d="M9 4H4v16h5m4-8h9m-4-4 4 4-4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.9 12.1 8.6-8.6M16 7l3 3M14 9l2 2"/>',
} as const;
export function icon(name: keyof typeof paths) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
export const wordmark = (light = false) =>
  `<img class="wordmark" src="/assets/brand/speck-wordmark-${light ? "lime" : "forest"}.svg" alt="speck" width="264" height="80">`;
