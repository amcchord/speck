import { escapeDetail as e } from './resource-story';
type Filter = { label: string; values: string[]; value: (row: HTMLElement) => string };
const views = new Map<string, {query:string;filters:string[];compact:boolean;offset:number}>();
/** Consistent in-memory views. Search indexes displayed metadata, never hidden
 * secrets; saved filters expire with the authenticated page. */
export function listWorkspace(root: HTMLElement, selector: string, name: string, options: {filters?:Filter[];size?:number} = {}) {
  root.querySelector('[data-list-controls]')?.remove();
  const rows = [...root.querySelectorAll<HTMLElement>(selector)];
  const index = new Map(rows.map(r=>[r,(r.textContent || '').toLocaleLowerCase()]));
  const filters=options.filters || [], size=options.size || 50;
  const state=views.get(name) || {query:'',filters:[],compact:false,offset:0};
  const controls=document.createElement('div'); controls.dataset.listControls=''; controls.className='list-workspace-controls';
  controls.innerHTML=`<div class="toolbar"><label class="list-search">Search ${e(name)}<input type="search" placeholder="Search displayed names, status and details" value="${e(state.query)}"></label>${filters.map((f,i)=>`<label>${e(f.label)}<select data-list-filter="${i}"><option value="">All ${e(f.label.toLowerCase())}</option>${f.values.map(v=>`<option value="${e(v)}">${e(v)}</option>`).join('')}</select></label>`).join('')}<button class="secondary" data-list-density aria-pressed="${state.compact}">Compact rows</button><button class="text-link" data-list-reset>Reset view</button></div><div class="list-result-bar"><span role="status" data-list-count></span><div><button class="secondary" data-list-prev>Previous</button><button class="secondary" data-list-next>Next</button></div></div>`;
  root.prepend(controls);
  const search=controls.querySelector('input')!;
  const selects=[...controls.querySelectorAll<HTMLSelectElement>('[data-list-filter]')];
  selects.forEach((s,i)=>s.value=state.filters[i] || '');
  const draw=()=>{
    const terms=state.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matches=rows.filter(r=>terms.every(t=>index.get(r)!.includes(t)) && filters.every((f,i)=>!state.filters[i]||f.value(r)===state.filters[i]));
    if(state.offset>=matches.length)state.offset=0;
    const visible=new Set(matches.slice(state.offset,state.offset+size));
    rows.forEach(r=>{r.hidden=!visible.has(r);});
    root.classList.toggle('compact-list',state.compact);
    controls.querySelector('[data-list-count]')!.textContent=matches.length?`${state.offset+1}–${Math.min(state.offset+size,matches.length)} of ${matches.length} results · ${rows.length} loaded`:'No matching results. Clear filters or try another name.';
    (controls.querySelector('[data-list-prev]') as HTMLButtonElement).disabled=state.offset===0;
    (controls.querySelector('[data-list-next]') as HTMLButtonElement).disabled=state.offset+size>=matches.length;
    views.set(name,state);
  };
  search.oninput=()=>{state.query=search.value;state.offset=0;draw();};
  selects.forEach((s,i)=>s.onchange=()=>{state.filters[i]=s.value;state.offset=0;draw();});
  controls.querySelector<HTMLButtonElement>('[data-list-prev]')!.onclick=()=>{state.offset=Math.max(0,state.offset-size);draw();};
  controls.querySelector<HTMLButtonElement>('[data-list-next]')!.onclick=()=>{state.offset+=size;draw();};
  controls.querySelector<HTMLButtonElement>('[data-list-density]')!.onclick=event=>{state.compact=!state.compact;(event.currentTarget as HTMLElement).setAttribute('aria-pressed',String(state.compact));draw();};
  controls.querySelector<HTMLButtonElement>('[data-list-reset]')!.onclick=()=>{state.query='';state.filters=[];state.offset=0;search.value='';selects.forEach(s=>s.value='');draw();};
  draw(); return {draw,rows};
}
export function clearListViews(){views.clear();}
