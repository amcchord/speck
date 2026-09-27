import {escapeDetail as e, capacity} from './resource-story';
import './performance.css';
type Item = Record<string, any>;
export function metricValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return 'Not reported';
  if (unit.startsWith('bytes')) return capacity(value)+(unit.endsWith('/s')?'/s':'');
  if (unit==='bit/s') {const power=value>=1e9?1e9:value>=1e6?1e6:value>=1e3?1e3:1;return (value/power).toLocaleString(undefined,{maximumFractionDigits:1})+' '+({1:'bit/s',1000:'Kbit/s',1000000:'Mbit/s',1000000000:'Gbit/s'} as Item)[power];}
  return value.toLocaleString(undefined,{maximumFractionDigits:1})+(unit==='%'?'%':' '+unit);
}
export function chartPath(points: [number,number|null][], width=600,height=112): string {
  if (!points.length) return '';
  const min=points[0][0], span=points[points.length-1][0]-min || 1;
  const max=Math.max(1,...points.map(p=>p[1]??0));let gap=true;
  return points.map(([time,value])=>{if(value===null || !Number.isFinite(value)){gap=true;return '';}const p=`${gap?'M':'L'}${((time-min)/span*width).toFixed(2)},${(height-value/max*(height-8)).toFixed(2)}`;gap=false;return p;}).join(' ');
}
export function performanceCards(series: Item[]): string {
  return series.map((s,i)=>{
    const points: [number,number|null][] = Array.isArray(s.points)?s.points:[];
    const values=points.filter((p)=>p[1]!==null&&Number.isFinite(p[1]));
    const last=values.at(-1),peak=Math.max(...values.map(p=>p[1]!));
    const start=points[0]?.[0],end=points.at(-1)?.[0];
    return `<article class="performance-card" data-chart="${i}"><div class="performance-heading"><h4>${e(s.label)}</h4><span>Peak ${last?e(metricValue(peak,s.unit)):'—'}</span></div><strong data-chart-value>${last?e(metricValue(last[1]!,s.unit)):'Not reported'}</strong><small data-chart-time>${last?e(new Date(last[0]*1000).toLocaleString()):'No provider readings for this interval'}</small>${last?`<svg viewBox="0 0 600 120" preserveAspectRatio="none" role="img" aria-label="${e(s.label)} over the selected interval"><path class="chart-grid" d="M0 28H600 M0 66H600 M0 112H600"/><path class="chart-line" d="${chartPath(points)}"/><line class="chart-cursor" y1="0" y2="112" hidden/></svg><div class="chart-axis"><span>${e(new Date(start*1000).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))}</span><span>${e(new Date(end!*1000).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}))}</span></div>`:'<div class="chart-empty">The provider did not report this measurement.</div>'}</article>`;
  }).join('');
}
export function mountPerformance(ui: Item, resource: Item, root: HTMLElement) {
  let range='day',generation=0;
  const path=`/infrastructure/connections/${resource.connection_id}/resources/${resource.kind}/${encodeURIComponent(resource.id)}/metrics`;
  root.innerHTML=`<div class="performance-head"><div><span class="resource-eyebrow">Provider telemetry</span><h3>Performance</h3></div><div><label>History<select data-history>${(resource.provider==='linode'?['hour','day']:['hour','day','week','month']).map(v=>`<option value="${v}" ${v===range?'selected':''}>${({hour:'Last hour',day:'24 hours',week:'7 days',month:'30 days'} as Item)[v]}</option>`).join('')}</select></label><button class="text-link" data-performance-refresh>Refresh</button></div></div><div class="performance-content" aria-live="polite"></div>`;
  const content=root.querySelector<HTMLElement>('.performance-content')!;
  async function load(fresh=false){
    const current=++generation;
    content.innerHTML='<p class="resource-note">Reading performance history…</p>';
    try {
      const data=await (fresh?ui.freshApi:ui.api)(path+'?timeframe='+range);
      if(!root.isConnected||generation!==current)return;
      const series=Array.isArray(data.series)?data.series:[];
      content.innerHTML=`<div class="performance-grid">${performanceCards(series)}</div><p class="resource-note">${e(data.note || 'No provider history is available.')}</p>`;
      root.querySelectorAll<HTMLElement>('[data-chart]').forEach(card=>{
        const s=series[Number(card.dataset.chart)],svg=card.querySelector('svg');if(!svg)return;
        svg.addEventListener('pointermove',event=>{
          const box=svg.getBoundingClientRect(),ratio=Math.max(0,Math.min(1,(event.clientX-box.left)/box.width));
          const stamp=s.points[0][0]+ratio*(s.points.at(-1)[0]-s.points[0][0]);
          const p=s.points.reduce((nearest:any,next:any)=>Math.abs(next[0]-stamp)<Math.abs(nearest[0]-stamp)?next:nearest);
          card.querySelector('[data-chart-value]')!.textContent=p[1]===null?'No reading':metricValue(p[1],s.unit);
          card.querySelector('[data-chart-time]')!.textContent=new Date(p[0]*1000).toLocaleString();
          const line=svg.querySelector('line')!;line.removeAttribute('hidden');line.setAttribute('x1',String(ratio*600));line.setAttribute('x2',String(ratio*600));
        });
      });
    }catch(error){if(root.isConnected&&current===generation)content.innerHTML='<p class="resource-notice">Performance history is unavailable. Check provider connectivity and read permissions, then refresh. Resource details remain available.</p>';}
  }
  root.querySelector('select')!.addEventListener('change',event=>{range=(event.target as HTMLSelectElement).value;void load();});
  root.querySelector('[data-performance-refresh]')!.addEventListener('click',()=>void load(true));
  void load();
}
