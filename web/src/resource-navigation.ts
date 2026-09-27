/** Addressable metadata only. Credentials, command text and remote-session tickets
 * must never be placed in a resource reference or browser history. */
export type ResourceRef = { kind: string; id: string; tab?: string; connection?: string; provider?: string; resourceKind?: string; site?: string };
type Open = (ref: ResourceRef) => void | Promise<void>;
const resolvers = new Map<string, Open>();
const recent = new Map<string, () => void | Promise<void>>();
let restoring = false;
let pendingNavigation: string | null = null;
const key = (ref: ResourceRef) => JSON.stringify(Object.fromEntries(Object.entries(ref).filter(([, v]) => v !== undefined).sort()));
export function currentResource(): ResourceRef | null {
  try {
    const raw = new URLSearchParams(location.hash.split('?')[1] || '').get('inspect');
    if (!raw || raw.length > 2048) return null;
    const ref = JSON.parse(raw);
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) || !ref.kind || !ref.id) return null;
    if (Object.entries(ref).some(([k,v]) => !['kind','id','tab','connection','provider','resourceKind','site'].includes(k) || typeof v !== 'string' || v.length > 512)) return null;
    return ref;
  } catch { return null; }
}
export function resourceHref(page: string, ref: ResourceRef) {
  return '#' + page.split('?')[0] + '?inspect=' + encodeURIComponent(key(ref));
}
export function registerResource(kind: string, open: Open) { resolvers.set(kind, open); }
export function rememberResource(ref: ResourceRef, open: () => void | Promise<void>) {
  const id = key(ref);
  pendingNavigation = id;
  recent.delete(id); recent.set(id, open);
  if (recent.size > 100) recent.delete(recent.keys().next().value!);
  if (!restoring && key(currentResource() || {kind:'',id:''}) !== id) {
    history.pushState({speckInspection:true}, '', resourceHref(location.hash.slice(1) || 'home', ref));
  }
}
export async function restoreResource() {
  const ref = currentResource();
  restoring = true;
  try {
    document.querySelectorAll<HTMLDialogElement>('dialog.device-drawer').forEach(p => { p.close(); p.remove(); });
    if (!ref) return;
    const open = recent.get(key(ref));
    if (open) await open();
    else if (resolvers.has(ref.kind)) await resolvers.get(ref.kind)!(ref);
    else throw new Error('This detail link is not available in this workspace. Open its inventory to inspect the current resource.');
  } finally { restoring = false; }
}
export function bindResourceNavigation(pane: HTMLDialogElement) {
  const ref = currentResource();
  if (!ref) return;
  const id = key(ref), head = pane.querySelector('.dialog-head');
  if (pendingNavigation !== id) return;
  pendingNavigation = null;
  if (!head || head.querySelector('[data-resource-navigation]')) return;
  const controls = document.createElement('span');
  controls.dataset.resourceNavigation = '';
  controls.className = 'resource-navigation';
  if (history.state?.speckInspection) {
    const back = document.createElement('button'); back.textContent = '← Back'; back.className = 'text-link';
    back.onclick = () => history.back(); controls.append(back);
  }
  const copy = document.createElement('button'); copy.textContent = 'Copy link'; copy.className = 'text-link';
  const url = location.href;
  copy.onclick = async () => { try { await navigator.clipboard.writeText(url); copy.textContent = 'Link copied'; } catch { copy.textContent = 'Copy from address bar'; } };
  controls.append(copy); head.insertBefore(controls, head.querySelector('.close'));
  pane.addEventListener('close', () => {
    if (!restoring && !document.querySelector('dialog.device-drawer[open]') && key(currentResource() || {kind:'',id:''}) === id)
      history.replaceState(null, '', location.hash.split('?')[0]);
  });
}
export function clearResourceHistory() { recent.clear(); pendingNavigation = null; }
