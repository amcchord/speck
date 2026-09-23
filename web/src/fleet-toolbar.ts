import { columns, type FleetPreferences } from './fleet-model';
import { icon } from './icons';

export const filterOptions: Record<string, { label: string; options: Record<string, string> }> = {
  'fleet-filter': {label:'Status', options:{all:'All statuses',online:'Online',offline:'Offline',review:'Needs review'}},
  'fleet-os': {label:'Operating system', options:{all:'All systems',windows:'Windows',linux:'Linux'}},
  'fleet-agent': {label:'Speck agent', options:{all:'All machines',installed:'With Speck agent',missing:'Without Speck agent',conflicts:'Identity needs review'}},
};
export function fleetToolbar(prefs: FleetPreferences, previews: boolean, viewer: boolean) {
  return `<div class="fleet-toolbar">
    <div class="search-field">${icon('search')}<input id="fleet-search" aria-label="Search devices" placeholder="Search machines, clients, hosts or apps"></div>
    <label class="fleet-agent-only">${icon('spark')}<span>Speck agents only</span><input id="fleet-agent-only" type="checkbox" role="switch" ${prefs.agent_filter === 'installed' ? 'checked' : ''}><span class="fleet-switch-track" aria-hidden="true"></span></label>
    <button id="fleet-filters" class="secondary fleet-tool" popovertarget="fleet-filters-panel" aria-expanded="false">${icon('filter')}<span>Filters</span><span id="fleet-filter-count" class="filter-count" hidden></span>${icon('chevron')}</button>
    <button id="fleet-view" class="secondary fleet-tool" popovertarget="fleet-view-panel" aria-expanded="false">${icon('columns')}<span>View</span>${icon('chevron')}</button>
    <div id="fleet-filters-panel" class="fleet-popover" popover="auto" role="group" aria-label="Fleet filters">
      <div class="fleet-popover-title"><strong>Filters</strong><button id="fleet-clear-filters" class="text-link">Clear all</button></div>
      ${Object.entries(filterOptions).map(([id,f])=>`<label>${f.label}<select id="${id}" aria-label="Filter ${f.label === 'Operating system' ? 'operating system' : f.label === 'Status' ? 'status' : f.label}">${Object.entries(f.options).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label>`).join('')}
    </div>
    <div id="fleet-view-panel" class="fleet-popover" popover="auto" role="group" aria-label="Fleet view">
      <div class="fleet-popover-title"><strong>View</strong></div>
      <button id="fleet-columns" class="fleet-view-action" aria-label="Columns">${icon('columns')}<span>Columns<small>Choose, reorder and resize</small></span>${icon('arrow')}</button>
      <div class="fleet-view-toggles"><label class="check">${icon('spark')}<span>Highlight agents</span><input id="fleet-highlight" type="checkbox" ${prefs.highlight_agents ? 'checked' : ''}></label>
      ${viewer ? '' : `<label class="check">${icon('eye')}<span>Screen previews</span><input id="fleet-previews" type="checkbox" ${previews ? 'checked' : ''}></label>`}</div>
      <div class="fleet-view-sort"><label>Sort by<select id="fleet-sort" aria-label="Sort machines">${Object.entries(columns).filter(([k])=>k!=='preview'||!viewer).map(([k,c])=>`<option value="${k}">${c.label}</option>`).join('')}</select></label><label>Direction<select id="fleet-direction" aria-label="Sort direction"><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div>
    </div>
  </div><div id="fleet-filter-chips" class="fleet-filter-chips" aria-label="Active filters" hidden></div>`;
}

export function updateFilterChips(values: Record<string,string>, clear: (id: string) => void) {
  const active = Object.entries(values).filter(([id,value])=>value!=='all' && !(id==='fleet-agent' && value==='installed'));
  const count=document.getElementById('fleet-filter-count')!;
  count.textContent=String(active.length);count.hidden=!active.length;
  document.getElementById('fleet-filters')!.classList.toggle('has-filters',!!active.length);
  (document.getElementById('fleet-clear-filters') as HTMLButtonElement).disabled=!active.length;
  const chips=document.getElementById('fleet-filter-chips')!;
  chips.hidden=!active.length;
  chips.innerHTML=active.map(([id,value])=>`<button class="filter-chip" data-clear-filter="${id}" aria-label="Remove ${filterOptions[id].options[value]} filter">${filterOptions[id].options[value]}${icon('close')}</button>`).join('');
  chips.querySelectorAll<HTMLButtonElement>('[data-clear-filter]').forEach(button=>button.onclick=()=>{
    clear(button.dataset.clearFilter!);
    (chips.querySelector('button') || document.getElementById('fleet-filters'))?.focus();
  });
}

export function bindFleetPopovers() {
  const abort=new AbortController();
  for(const name of ['filters','view']) {
    const button=document.getElementById(`fleet-${name}`)!;
    const panel=document.getElementById(`fleet-${name}-panel`)!;
    const position=()=>{
      if(!panel.matches(':popover-open')) return;
      const anchor=button.getBoundingClientRect(),box=panel.getBoundingClientRect();
      panel.style.left=`${Math.max(8,Math.min(anchor.right-box.width,innerWidth-box.width-8))}px`;
      panel.style.top=`${Math.max(8,Math.min(anchor.bottom+8,innerHeight-box.height-8))}px`;
    };
    panel.addEventListener('toggle',()=>{button.setAttribute('aria-expanded',String(panel.matches(':popover-open')));position();});
    window.addEventListener('resize',position,{signal:abort.signal});
    window.addEventListener('scroll',position,{signal:abort.signal, capture:true});
  }
  return ()=>abort.abort();
}
