import { detailFacts as facts, detailSection as section, detailStatus as status, detailHero as hero, escapeDetail as e, technicalDetail, detailDate } from './resource-story';
import { rememberResource, registerResource } from './resource-navigation';
type Item = Record<string, any>;
const pending = (s: string) => ['queued','leased','running'].includes(s);
export function operationOutput(result: Item | null): string {
  if (!result) return '<p class="resource-note">No result has been reported.</p>';
  let parsed: any;
  try { parsed = JSON.parse(result.stdout); } catch { /* Exact output remains available. */ }
  const summary = parsed && typeof parsed === 'object' ? technicalDetail(parsed) : '';
  return (result.error ? `<p class="resource-notice">${e(result.error)}</p>` : '') + summary +
    (result.stdout !== undefined ? `<details open class="resource-technical"><summary>Standard output</summary><pre>${e(result.stdout || '(empty)')}</pre></details>` : technicalDetail(result)) +
    (result.stderr ? `<details open class="resource-technical"><summary>Standard error</summary><pre>${e(result.stderr)}</pre></details>` : '');
}
export function createRunDetails(ui: Item) {
  const {api, flyout} = ui;
  const duration = (start: number, end: number) => start ? Math.max(0, Math.round(((end || Date.now()/1000)-start)))+' seconds' : 'Not started';
  async function job(id: string) {
    rememberResource({kind:'job',id}, () => job(id));
    const pane: HTMLDialogElement = flyout('Job details', '<p class="resource-note">Reading operation evidence…</p>', {tone:'automation'});
    const target = pane.querySelector('.resource-body')!;
    async function load() {
      try {
        const j = await api('/jobs/'+encodeURIComponent(id));
        if (!pane.open || !target.isConnected) return;
        target.innerHTML = hero('Endpoint operation', j.status, j.kind.replaceAll('.',' · ')) + facts([
          ['Requested by',j.actor],['Created',detailDate(j.created)],['Started',detailDate(j.started)],['Finished',detailDate(j.finished)],['Elapsed',duration(j.started,j.finished)],['Exit code',j.result?.exit_code],
        ]) + (['unknown','expired'].includes(j.status) ? '<p class="resource-notice">The outcome is not confirmed. Inspect the machine before attempting the operation again.</p>' : '') +
          section('Target', `<button class="secondary" data-run-machine>${e(j.device_id)} →</button>`) + section('Result',operationOutput(j.result)) +
          `<details class="resource-technical"><summary>Request and receipt</summary>${technicalDetail(j)}</details><button class="secondary" data-run-refresh>Refresh evidence</button>`;
        target.querySelector<HTMLButtonElement>('[data-run-machine]')!.onclick = () => ui.openDevice(j.device_id);
        target.querySelector<HTMLButtonElement>('[data-run-refresh]')!.onclick = () => void load();
        if (pending(j.status)) setTimeout(() => { if (pane.open && target.isConnected) void load(); },3000);
      } catch (error) { if (pane.open) target.textContent = (error as Error).message; }
    }
    await load();
  }
  async function batch(id: string) {
    rememberResource({kind:'batch',id}, () => batch(id));
    const pane: HTMLDialogElement = flyout('Operation results', '<p class="resource-note">Reading per-machine results…</p>', {tone:'automation'});
    const target = pane.querySelector('.resource-body')!;
    async function load() {
      try {
        const b = await api('/batches/'+encodeURIComponent(id));
        if (!pane.open || !target.isConnected) return;
        const jobs: Item[] = b.jobs || [], completed = jobs.filter(j => j.status==='complete').length;
        target.innerHTML = hero('Reviewed operation', jobs.some(j=>pending(j.status)) ? 'In progress' : jobs.every(j=>j.status==='complete') ? 'complete' : 'Needs review', b.name,
          [['Completed',`${completed} / ${jobs.length}`],['Pending',jobs.filter(j=>pending(j.status)).length],['Needs review',jobs.filter(j=>!pending(j.status)&&j.status!=='complete').length]]) +
          facts([['Requested by',b.actor || b.created_by],['Created',detailDate(b.created)],['Operation',b.kind],['Template revision',b.template_revision]]) +
          section('Targets & results', `<div class="resource-related">${jobs.map((j,i)=>`<div><span><button class="text-link" data-run-machine="${i}">${e(j.label || j.device_id)}</button><small>${e(j.result?.error || (j.result ? 'Exit '+j.result.exit_code : 'Awaiting agent result'))}</small></span><button class="text-link" data-run-job="${i}">${status(j.status)} →</button></div>`).join('') || '<p>No jobs are recorded for this operation.</p>'}</div>`) +
          `<div class="toolbar"><button class="secondary" data-run-refresh>Refresh evidence</button>${jobs.some(j=>j.status==='queued') && ui.role()!=='viewer' ? '<button class="secondary" data-run-cancel>Cancel queued jobs</button>' : ''}</div><p class="resource-note">Running work continues when this view closes. Each machine reports its own outcome.</p>` + technicalDetail(b);
        target.querySelectorAll<HTMLButtonElement>('[data-run-machine]').forEach(btn => btn.onclick=()=>ui.openDevice(jobs[Number(btn.dataset.runMachine)].device_id));
        target.querySelectorAll<HTMLButtonElement>('[data-run-job]').forEach(btn => btn.onclick=()=>void job(jobs[Number(btn.dataset.runJob)].id));
        target.querySelector<HTMLButtonElement>('[data-run-refresh]')!.onclick=()=>void load();
        const cancel = target.querySelector<HTMLButtonElement>('[data-run-cancel]');
        if (cancel) cancel.onclick = async () => { cancel.disabled=true; try { const r=await api('/batches/'+encodeURIComponent(id)+'/cancel','POST'); ui.notify(`${r.cancelled} queued jobs cancelled. Running jobs continue.`); await load(); } catch(error) {ui.notify((error as Error).message,true); cancel.disabled=false;} };
        if (jobs.some(j=>pending(j.status))) setTimeout(()=>{if(pane.open&&target.isConnected) void load();},3000);
      } catch(error) { if(pane.open) target.textContent=(error as Error).message; }
    }
    await load();
  }
  registerResource('job', ref=>job(ref.id)); registerResource('batch',ref=>batch(ref.id));
  return {job,batch};
}
