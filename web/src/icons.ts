// A small, consistent icon set. Stroke geometry is independent of installed fonts.
const paths: Record<string, string> = {
  fleet:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  recovery: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  slide: '<path d="m6 6 15 0-3 12H3Z"/><path d="M8 10h8M7 14h8"/>',
  activity: '<path d="M2 12h4l3-7 6 14 3-7h4"/>',
  settings:
    '<path d="M5 3v18M12 3v18M19 3v18"/><rect x="2" y="6" width="6" height="4" rx="1" fill="currentColor"/><rect x="9" y="14" width="6" height="4" rx="1" fill="currentColor"/><rect x="16" y="7" width="6" height="4" rx="1" fill="currentColor"/>',
  windows:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>',
  linux:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  refresh:
    '<path d="M20 7a9 9 0 0 0-15-1L2 9m0-6v6h6m-4 8a9 9 0 0 0 15 1l3-3m0 6v-6h-6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  logout: '<path d="M9 4H4v16h5m4-8h9m-4-4 4 4-4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
export function icon(name: string) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.fleet}</svg>`;
}
export const wordmark = (light = false) =>
  `<img class="wordmark" src="/assets/brand/speck-wordmark-${light ? "lime" : "forest"}.svg" alt="speck" width="264" height="80">`;
