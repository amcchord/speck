/** Addressable metadata only. Credentials, command text and remote-session tickets
 * must never be placed in a resource reference or browser history. */
export type ResourceRef = { kind: string; id: string; tab?: string; connection?: string; provider?: string; resourceKind?: string; site?: string };
type Open = (ref: ResourceRef) => void | Promise<void>;
const resolvers = new Map<string, Open>();
const recent = new Map<string, () => void | Promise<void>>();
let restoring = false;
let restoreVersion = 0;
let pendingNavigation: string | null = null;
const identity = (ref: ResourceRef) => key({...ref,tab:undefined});
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
  const parts=page.replace(/^#/, '').split('?');
  const params=new URLSearchParams(parts[1] || (parts[0]===location.hash.slice(1).split('?')[0] ? location.hash.split('?')[1] || '' : ''));
  const workspace=new URLSearchParams(location.hash.split('?')[1] || '').get('workspace');if(workspace&&!params.has('workspace'))params.set('workspace',workspace);
  params.set('inspect',key(Object.fromEntries(Object.entries(ref).filter(([k,v])=>['kind','id','tab','connection','provider','resourceKind','site'].includes(k)&&typeof v==='string'&&v.length)) as ResourceRef));
  return '#' + parts[0] + '?' + params.toString();
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
  const ref = currentResource(), version = ++restoreVersion;
  restoring = true;
  try {
    document.querySelectorAll<HTMLDialogElement>('dialog.device-drawer').forEach(p => { p.close(); p.remove(); });
    if (!ref) return;
    const open = recent.get(key(ref));
    if (open) await open();
    else if (resolvers.has(ref.kind)) await resolvers.get(ref.kind)!(ref);
    else throw new Error('This detail link is not available in this workspace. Open its inventory to inspect the current resource.');
  } finally { if(version===restoreVersion)restoring = false; }
}
export function bindResourceNavigation(pane: HTMLDialogElement) {
  const ref = currentResource();
  if (!ref) return;
  const id = key(ref), head = pane.querySelector('.dialog-head');
  if (!pendingNavigation || identity(JSON.parse(pendingNavigation)) !== identity(ref)) return;
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
  copy.onclick = async () => { try { await navigator.clipboard.writeText(currentResource() && identity(currentResource()!) === identity(ref) ? location.href : url); copy.textContent = 'Link copied'; } catch { copy.textContent = 'Copy from address bar'; } };
  controls.append(copy); head.insertBefore(controls, head.querySelector('.close'));
  pane.addEventListener('close', () => {
    if (!restoring && !document.querySelector('dialog.device-drawer[open]') && identity(currentResource() || {kind:'',id:''}) === identity(ref))
      { const params=new URLSearchParams(location.hash.split('?')[1] || ''); params.delete('inspect'); history.replaceState(null,'',location.hash.split('?')[0]+(params.size?'?'+params:'')); }
  });
}
export function clearResourceHistory() { recent.clear(); pendingNavigation = null; restoring = false; restoreVersion++; }
export function resourceCheckpoint() {
  const version=restoreVersion, active=restoring, ref=key(currentResource() || {kind:"",id:""});
  return () => !active || version===restoreVersion && ref===key(currentResource() || {kind:"",id:""});
}

export function workspaceTab(fallback:string, allowed:string[]):string {
  const tab=new URLSearchParams(location.hash.split('?')[1] || '').get('view');
  return tab && allowed.includes(tab) ? tab : fallback;
}
export function setWorkspaceTab(tab:string) {
  const params=new URLSearchParams(location.hash.split('?')[1] || ''); params.set('view',tab); params.delete('inspect');
  history.pushState(null,'',location.hash.split('?')[0]+'?'+params);
}

/** Keep native open-in-new-tab behavior, and mark ordinary inspection hops so
 * the shared pane can offer Back. Hash routing still owns rendering. */
export function installResourceLinks() {
  document.addEventListener('click',event=>{
    if(event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor=(event.target as Element)?.closest<HTMLAnchorElement>('a[href]');
    if(!anchor || anchor.target || anchor.hasAttribute('download'))return;
    const url=new URL(anchor.href,location.href);
    if(url.origin!==location.origin || url.pathname!==location.pathname || !new URLSearchParams(url.hash.split('?')[1] || '').has('inspect'))return;
    event.preventDefault(); const oldURL=location.href;
    history.pushState({speckInspection:true},'',url.hash);
    window.dispatchEvent(new HashChangeEvent('hashchange',{oldURL,newURL:location.href}));
  });
}
