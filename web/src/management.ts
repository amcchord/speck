import { entityLink } from './entity-links';
import {startJourney} from './ux-quality';
import { listWorkspace } from "./list-workspace";
import { rememberResource, registerResource, resourceHref } from "./resource-navigation";
import { operationOutput } from "./run-detail";
import { available as passkeysAvailable, ceremony as passkeyCeremony } from "./passkeys";
import { eventLabel } from "./activity-model";
import { detailSection, detailFacts, technicalDetail } from "./resource-story";
import { loadingState } from "./loading";
import "./management.css";
type Item = Record<string, any>;

export function createManagement(ui: Item) {
  const { api, esc, date, badge, on, value, notify, content } = ui;
  const dialog: (title: string, body: string) => HTMLDialogElement = ui.dialog;
  const canManage = () => ui.role() !== "viewer";
  const isAdmin = () => ui.role() === "admin";
  const button = (id: string, text: string, primary = false) =>
    `<button id="${id}" class="${primary ? "primary" : "secondary"}">${text}</button>`;
  const checked = (id: string) =>
    (document.getElementById(id) as HTMLInputElement)?.checked;
  const localTime = (stamp = Date.now() + 300000) => {
    const d = new Date(stamp);
    return new Date(stamp - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  const timestamp = (id: string) => new Date(value(id)).getTime() / 1000;
  const empty = (title: string, text: string) =>
    `<div class="empty management-empty"><h2>${title}</h2><p>${text}</p></div>`;
  let alertState = "active",
    alertDevice = "",
    alertCursor = "";

  async function renderAlerts() {
    ui.loading("Loading alerts…");
    const [data, devices, monitoring] = await Promise.all([
      api(
        "/alerts?state=" +
          alertState +
          (alertDevice ? "&device_id=" + alertDevice : "") +
          (alertCursor ? "&before_id=" + alertCursor : ""),
      ),
      api("/devices"),
      api("/monitoring"),
    ]);
    const machineOptions = new Map(devices.map((d: Item) => [d.id, d.label]));
    data.items.forEach((a: Item) => machineOptions.set(a.device_id, a.label || "Retired machine"));
    if (alertDevice && !machineOptions.has(alertDevice)) machineOptions.set(alertDevice, "Selected machine");
    content(
      `<section class="alerts-workspace" aria-label="Fleet alerts"><div class="alerts-toolbar"><label>Status<select id="alert-state"><option value="active">Open alerts</option><option value="unacknowledged">Needs attention</option><option value="resolved">Resolved</option><option value="all">All history</option></select></label><label>Machine<select id="alert-machine"><option value="">All machines</option>${Array.from(machineOptions, ([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join("")}</select></label>${isAdmin() ? '<button id="monitor-defaults" class="secondary" data-page-action>Monitoring policy</button>' : ""}</div><div id="alert-list"></div></section>`,
    );
    ui.summary?.(
      `<span><b>${data.counts.active || 0}</b> open</span><span><b>${data.counts.unacknowledged || 0}</b> need attention</span><span class="monitor-status${monitoring.healthy ? "" : " warn"}">${monitoring.healthy ? "Monitoring every 15s" : "Monitoring worker delayed"}</span>`,
    );
    (document.getElementById("alert-state") as HTMLSelectElement).value =
      alertState;
    (document.getElementById("alert-machine") as HTMLSelectElement).value =
      alertDevice;
    on(
      "alert-state",
      async () => {
        alertState = value("alert-state");
        alertCursor = "";
        await renderAlerts();
      },
      "change",
    );
    on(
      "alert-machine",
      async () => {
        alertDevice = value("alert-machine");
        alertCursor = "";
        await renderAlerts();
      },
      "change",
    );
    on("monitor-defaults", () => editPolicy());
    const list = document.getElementById("alert-list")!;
    list.innerHTML = data.items.length
      ? `<div class="alert-columns" aria-hidden="true"><span>Alert</span><span>Machine / status</span><span>Opened</span><span>AI actions</span></div><div class="alert-list">${data.items.map((a: Item, i: number) => {
          const device = devices.find((d: Item) => d.id === a.device_id);
          const manageable = device && device.approved && !device.archived;
          const state = a.resolved ? "Resolved" : a.acknowledged ? "Acknowledged" : "Needs attention";
          const age = Math.max(0, Date.now() / 1000 - a.opened);
          const when = age < 60 ? "Just now" : age < 3600 ? Math.floor(age / 60) + "m ago" : age < 86400 ? Math.floor(age / 3600) + "h ago" : Math.floor(age / 86400) + "d ago";
          return `<article class="alert-item" data-severity="${esc(a.severity)}" data-type="${esc(a.key.split(':')[0])}" data-site="${esc(device?.site || 'Unassigned')}" data-age="${age>86400?'Older than a day':'Last 24 hours'}"><div class="alert-row"><div class="alert-main"><button id="alert-details-${i}" class="alert-title" aria-haspopup="dialog"><span class="alert-marker ${a.resolved ? "resolved" : esc(a.severity)}" title="${esc(a.severity)}" aria-label="${esc(a.severity)}"></span><span>${esc(a.title)}</span><span class="alert-chevron" aria-hidden="true">›</span></button><p class="alert-description" title="${esc(a.explanation || "Expand for alert details")}">${esc(a.explanation || "Expand for alert details")}</p></div><div class="alert-machine"><button id="alert-device-${i}" class="text-link">${esc(a.label || "Retired machine")}</button><small class="alert-state">${state}${a.maintenance_until > Date.now() / 1000 ? " · Maintenance" : ""}</small></div><time class="alert-age" datetime="${new Date(a.opened * 1000).toISOString()}" title="${date(a.opened)}">${when}</time><div class="alert-actions">${canManage() && manageable ? `${button("diagnose-" + i, "AI diagnose")}${!a.resolved ? button("fix-" + i, "AI fix") : ""}` : `<small>${canManage() ? "Machine unavailable" : esc(a.severity)}</small>`}</div></div><div id="alert-evidence-${i}" class="alert-evidence" hidden><p>${esc(a.explanation || a.title)}</p><div class="alert-evidence-meta"><span>Opened ${date(a.opened)}</span>${a.acknowledged ? `<span>Acknowledged by ${esc(a.ack_actor)} · ${date(a.acknowledged)}</span>` : ""}${a.resolved ? `<span>Resolved by ${esc(a.resolve_actor)} · ${date(a.resolved)}</span>` : ""}</div>${a.job ? `<div class="alert-evidence-meta"><span>Job <code>${esc(a.job.id)}</code></span><span>${esc(a.job.kind)} · ${esc(a.job.status)}</span><span>Requested by ${esc(a.job.actor)}</span></div>` : ""}<div id="alert-job-${i}"></div><div class="alert-review-actions">${!a.resolved && canManage() ? `${!a.acknowledged ? button("ack-" + i, "Acknowledge") : ""}${a.key.startsWith("job:") ? button("resolve-" + i, "Mark reviewed") : ""}` : ""}<small>${esc(a.resolution_hint || "Health alerts clear after recovery. Closing a job alert does not fix the machine.")}</small></div></div></article>`;
        }).join("")}</div><small class="management-footnote">${data.items.length} matching alert${data.items.length === 1 ? "" : "s"}. AI drafts are reviewed before execution.</small>`
      : empty(
          alertState === "active" && !alertDevice ? "All clear" : "No matching alerts",
          "No conditions match this view. Monitoring continues in the background.",
        );
    list.insertAdjacentHTML(
      "beforeend",
      `<div class="management-footer">${alertCursor ? button("alerts-newest", "Newest alerts") : ""}${data.next_cursor ? button("alerts-older", "Older alerts") : ""}</div>`,
    );
    on("alerts-newest", async () => {
      alertCursor = "";
      await renderAlerts();
    });
    on("alerts-older", async () => {
      alertCursor = data.next_cursor;
      await renderAlerts();
    });
    listWorkspace(list,'.alert-item','alerts',{collapsible:true,filters:[
      {label:'Severity',values:[...new Set(data.items.map((a:Item)=>a.severity))] as string[],value:r=>r.dataset.severity!},
      {label:'Type',values:[...new Set(data.items.map((a:Item)=>a.key.split(':')[0]))] as string[],value:r=>r.dataset.type!},
      {label:'Site',values:[...new Set(devices.map((d:Item)=>d.site || 'Unassigned'))] as string[],value:r=>r.dataset.site!},
      {label:'Age',values:['Last 24 hours','Older than a day'],value:r=>r.dataset.age!},
    ]});
    list.querySelector('[data-list-controls] details')?.append(document.querySelector('.alerts-toolbar')!);
    const groups=new Map<string,Item[]>();for(const alert of data.items){const key=alert.title+' · '+alert.key.split(':')[0];groups.set(key,[...(groups.get(key)||[]),alert]);}
    const grouped=document.createElement('button');grouped.className='secondary';grouped.textContent='Related symptoms';document.querySelector('.alerts-toolbar')!.append(grouped);grouped.onclick=()=>{const pane:HTMLDialogElement=ui.flyout('Related alert symptoms','<p class="resource-note">Grouped by reported title and condition type within the loaded alert page. Each machine and occurrence retains its own evidence and review state.</p>'+[...groups].sort((a,b)=>b[1].length-a[1].length).map(([title,rows])=>detailSection(title,'<p>'+rows.length+' occurrences · '+new Set(rows.map(a=>a.device_id)).size+' machines</p><div class="resource-related">'+rows.map(a=>`<button data-group-alert="${esc(a.id)}"><span><b>${esc(a.label || a.device_id)}</b><small>${date(a.opened)} · ${a.resolved?'Resolved':a.acknowledged?'Acknowledged':'Needs attention'}</small></span>→</button>`).join('')+'</div>')).join(''),{tone:'attention'});pane.querySelectorAll<HTMLElement>('[data-group-alert]').forEach(b=>b.onclick=()=>{const a=data.items.find((a:Item)=>a.id===b.dataset.groupAlert);void inspectAlert(a,devices.find((d:Item)=>d.id===a.device_id));});};
    data.items.forEach((a: Item, i: number) => {
      on("alert-device-" + i, () => ui.openDevice(a.device_id));
      on("ack-" + i, async () => {
        await api("/alerts/" + a.id, "POST", { action: "acknowledge" });
        await renderAlerts();
      });
      on("resolve-" + i, async () => {
        await api("/alerts/" + a.id, "POST", { action: "resolve" });
        await renderAlerts();
      });
      const device = devices.find((d: Item) => d.id === a.device_id);
      on("diagnose-" + i, () => ui.assistAlert(device, a, "diagnose"));
      on("fix-" + i, () => ui.assistAlert(device, a, "fix"));
      on("alert-details-" + i, () => inspectAlert(a,device));
    });
  }

  async function inspectAlert(a:Item,device?:Item) {
    const finish=startJourney("alert_to_evidence","alerts");
    rememberResource({kind:'alert',id:a.id},()=>inspectAlert(a,device));
    const check=a.key.startsWith('job:')?'Inspect the exact job result and current machine state. An uncertain completion does not establish failure; avoid repeating an action until verified.':a.key.includes('offline')?'Check the last agent report, gateway path and maintenance window before restarting services.':a.key.includes('disk')?'Inspect affected volumes and growth before deleting data.':a.key.includes('service')?'Inspect startup mode, dependencies and recent service failures before restarting.':'Compare the current reading with the configured threshold and inspect related machine activity.';
    const pane:HTMLDialogElement=ui.flyout(a.title,detailSection('Condition',`<p>${esc(a.explanation || a.title)}</p>`)+detailFacts([['Severity',a.severity],['Machine',a.label],['Opened',date(a.opened)],['Last observation',date(a.updated)],['Acknowledged',a.acknowledged?date(a.acknowledged)+' · '+a.ack_actor:'Not acknowledged'],['Resolved',a.resolved?date(a.resolved)+' · '+a.resolve_actor:'No recovery recorded']])+detailSection('First checks',`<p>${esc(check)}</p><p class="resource-note">${esc(a.resolution_hint || 'Health alerts clear when recovery is observed. Acknowledging an alert does not change the machine.')}</p>`)+`<div class="toolbar"><button class="secondary" data-alert-machine>Inspect machine</button>${a.job?'<button class="secondary" data-alert-job>Open job result</button>':''}${device&&canManage()?'<button class="secondary" data-alert-maintenance>Review maintenance</button>':''}</div><section class="resource-section" data-alert-evidence></section><div class="toolbar">${!a.resolved&&canManage()?`${!a.acknowledged?'<button class="secondary" data-alert-ack>Acknowledge</button>':''}${a.key.startsWith('job:')?'<button class="secondary" data-alert-resolve>Mark reviewed</button>':''}`:''}</div>`,{tone:'attention',subtitle:'Alert · Evidence and investigation'});
    pane.querySelector<HTMLButtonElement>('[data-alert-machine]')!.onclick=()=>ui.openDevice(a.device_id);
    pane.querySelector<HTMLButtonElement>('[data-alert-job]')?.addEventListener('click',()=>void ui.showJob(a.job.id));
    pane.querySelector<HTMLButtonElement>('[data-alert-maintenance]')?.addEventListener('click',()=>void organize(device!));
    for(const [attr,action] of [['ack','acknowledge'],['resolve','resolve']]) pane.querySelector<HTMLButtonElement>('[data-alert-'+attr+']')?.addEventListener('click',async()=>{try{await api('/alerts/'+a.id,'POST',{action});pane.close();await renderAlerts();}catch(error){notify((error as Error).message,true);}});
    if(a.job&&canManage())try {const detail=await api('/alerts/'+encodeURIComponent(a.id));if(pane.open)pane.querySelector('[data-alert-evidence]')!.innerHTML='<h3>Job evidence</h3>'+operationOutput(detail.job?.result);} catch {finish('failed');if(pane.open)pane.querySelector('[data-alert-evidence]')!.textContent='Job evidence is unavailable. Inspect the machine before retrying.';}
    finish(pane.open?'ready':'cancelled');
  }
  registerResource('alert',async ref=>{const data=await api('/alerts/'+encodeURIComponent(ref.id));await inspectAlert(data.alert || data);});

  async function editPolicy(device?: Item) {
    const policies = await api("/monitoring");
    const p = (device && policies.overrides[device.id]) || policies.default;
    const modal = dialog(
      device ? "Monitor " + device.label : "Monitoring policy",
      `<p>${device ? "These thresholds apply to this machine." : "Defaults apply to machines without an override."} CPU, memory and disk alerts clear five percentage points below their trigger.</p><label class="check"><input type="checkbox" id="monitor-enabled" ${p.enabled ? "checked" : ""}> Monitor health and failed jobs</label><div class="form-grid"><label>Offline after (seconds)<input id="monitor-offline" type="number" min="90" max="86400" value="${p.offline_seconds}"></label><label>Sustained condition (seconds)<input id="monitor-hold" type="number" min="30" max="3600" value="${p.hold_seconds}"></label>${["cpu", "memory", "disk"].map((k) => `<label>${k === "cpu" ? "CPU" : k[0].toUpperCase() + k.slice(1)} used (%)<input id="monitor-${k}" type="number" min="50" max="100" value="${p[k + "_percent"]}"></label>`).join("")}</div>${device ? `<label>Watched services<textarea id="monitor-services" rows="4" placeholder="${device.platform === "windows" ? "Spooler" : "asterisk.service"}">${esc(p.services.join("\n"))}</textarea><small>Exact service names, one per line. A stopped or missing service triggers an alert.</small></label>` : ""}<div class="dialog-footer">${device && policies.overrides[device.id] ? button("monitor-reset", "Use defaults") : ""}${button("monitor-save", "Save policy", true)}</div>`,
    );
    modal.classList.add("monitoring-dialog");
    on("monitor-save", async () => {
      await api(
        device ? "/devices/" + device.id + "/monitoring" : "/monitoring",
        "PUT",
        {
          enabled: checked("monitor-enabled"),
          offline_seconds: Number(value("monitor-offline")),
          hold_seconds: Number(value("monitor-hold")),
          cpu_percent: Number(value("monitor-cpu")),
          memory_percent: Number(value("monitor-memory")),
          disk_percent: Number(value("monitor-disk")),
          services: device
            ? value("monitor-services")
                .split("\n")
                .map((s: string) => s.trim())
                .filter(Boolean)
            : [],
        },
      );
      modal.close();
      notify("Monitoring policy saved");
    });
    on("monitor-reset", async () => {
      await api("/devices/" + device!.id + "/monitoring", "DELETE");
      modal.close();
      notify("Default monitoring restored");
    });
  }

  function devicePanel(d: Item, body: Element) {
    body.insertAdjacentHTML(
      "beforeend",
      `<article class="panel organization-panel"><div class="section-head"><h3>Organization & monitoring</h3>${canManage() && !d.archived ? button("device-organize", "Manage") : ""}</div><div class="mini-grid"><div><small>Site</small>${esc(d.site || "Unassigned")}</div><div><small>Tags</small>${(d.tags || []).map((t: string) => `<span class="badge neutral">${esc(t)}</span>`).join(" ") || "None"}</div><div><small>Monitoring</small>${d.archived ? "Archived" : !d.approved ? "Awaiting approval" : d.maintenance_until > Date.now() / 1000 ? "Maintenance until " + date(d.maintenance_until) : d.monitoring_enabled === false ? "Disabled" : "Active"}</div></div>${canManage() && d.approved && !d.archived ? button("device-monitoring", "Watch services & health") : ""}</article>`,
    );
    on("device-organize", () => organize(d));
    on("device-monitoring", () => editPolicy(d));
  }
  async function organize(d: Item) {
    const modal = dialog(
      "Manage " + d.label,
      `<label>Site<input id="org-site" maxlength="80" value="${esc(d.site || "")}" placeholder="Brace Yourself Dental"></label><label>Tags<input id="org-tags" value="${esc((d.tags || []).join(", "))}" placeholder="reception, critical"><small>Separate tags with commas.</small></label><label>Maintenance until<input id="org-maintenance" type="datetime-local" value="${d.maintenance_until > Date.now() / 1000 ? localTime(d.maintenance_until * 1000) : ""}"><small>Suppresses new alerts. Clear this field to end maintenance.</small></label><div class="dialog-footer">${button("org-save", "Save changes", true)}</div><hr><h3>Retirement</h3><p>Archive removes this machine from the active fleet, cancels queued work, disables previews and closes remote sessions. History and Slide links remain available. Running commands may still finish on the endpoint.</p>${button("org-archive", "Archive machine")}${isAdmin() ? "<hr>" + button("org-revoke", "Revoke installation credential…") : ""}`,
    );
    on("org-save", async () => {
      await api("/devices/" + d.id + "/organization", "PUT", {
        site: value("org-site"),
        tags: value("org-tags")
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean),
        maintenance_until: value("org-maintenance")
          ? timestamp("org-maintenance")
          : 0,
      });
      modal.close();
      notify("Machine updated");
      await ui.refresh();
    });
    on("org-archive", async () => {
      const confirm = dialog(
        "Archive " + d.label + "?",
        `<p>You can restore this machine to the fleet later from Settings.</p>${button("archive-confirm", "Archive machine", true)}`,
      );
      on("archive-confirm", async () => {
        await api("/devices/" + d.id + "/archive", "PUT", { archived: true });
        confirm.close();
        modal.close();
        notify("Machine archived");
        await ui.refresh();
      });
    });
    on("org-revoke", async () => {
      const installation = await api("/devices/" + d.id + "/installation");
      const confirm = dialog(
        "Revoke installation credential",
        `<p>This permanently rejects the shared credential for every instance below, including restored copies. Each will need fresh enrollment to reconnect.</p><ul>${installation.devices.map((x: Item) => `<li>${esc(x.label)}</li>`).join("")}</ul><label class="check"><input type="checkbox" id="revoke-ack"> Revoke all ${installation.devices.length} listed instances</label>${button("revoke-confirm", "Revoke credential", true)}`,
      );
      on("revoke-confirm", async () => {
        if (!checked("revoke-ack"))
          throw new Error("Confirm the affected instances first.");
        await api("/devices/" + d.id + "/installation/revoke", "POST", {
          confirmed: true,
          affected_device_ids: installation.devices.map((x: Item) => x.id),
        });
        confirm.close();
        modal.close();
        notify("Installation credential revoked");
        await ui.refresh();
      });
    });
  }

  async function renderSchedules() {
    ui.loading("Loading schedules…");
    const [schedules, devices] = await Promise.all([
      api("/schedules"),
      api("/devices?include_archived=true"),
    ]);
    content(
      `<button id="new-schedule" class="primary" data-page-action>New schedule</button>${
        schedules.length
          ? `<div class="schedule-grid">${schedules
              .map(
                (s: Item, i: number) =>
                  `<article class="panel schedule-card"><div class="section-head"><span class="eyebrow">${s.operation.kind === "patch.scan" ? "PATCH INVENTORY" : "SCRIPT / SOFTWARE"}</span>${badge(s.enabled ? "Active" : "Paused", !!s.enabled)}</div><h2><button class="text-link" data-schedule-detail="${esc(s.id)}">${esc(s.name)}</button></h2><p>${s.interval_seconds ? "Every " + (s.interval_seconds / 3600).toLocaleString() + " hours" : "One-time operation"} · ${s.operation.device_ids.length} machine${s.operation.device_ids.length === 1 ? "" : "s"}</p><dl class="schedule-facts"><div><dt>Next run</dt><dd>${s.enabled ? date(s.next_run) : "Paused"}</dd></div><div><dt>Owner</dt><dd>${esc(s.owner)}</dd></div>${s.operation.template_revision ? `<div><dt>Template</dt><dd>Revision ${s.operation.template_revision}</dd></div>` : ""}</dl><details><summary>Target machines</summary><ul>${s.operation.device_ids.map((id: string) => `<li>${entityLink({kind:"machine",id},devices.find((d: Item) => d.id === id)?.label || id)}</li>`).join("")}</ul></details><div class="schedule-runs">${
                    s.runs
                      .slice(0, 4)
                      .map(
                        (r: Item) =>
                          `<div><span>${badge(r.status)} <small>${date(r.due)}</small></span>${r.reason ? `<p>${esc(r.reason)}</p>` : r.batch_id ? `<button class="text-link" data-schedule-batch="${r.batch_id}">View operation results</button>` : ""}</div>`,
                      )
                      .join("") || "<small>No runs yet</small>"
                  }</div>${isAdmin() || s.owner === ui.username() ? button("schedule-state-" + i, s.enabled ? "Pause schedule" : "Resume…") : ""}</article>`,
              )
              .join("")}</div>`
          : empty(
              "Make routine work automatic",
              "Schedule update inventories, health checks or a reviewed software template.",
            )
      }`,
    );
    listWorkspace(document.getElementById('content')!,'.schedule-card','schedules');
    document.querySelectorAll<HTMLButtonElement>('[data-schedule-detail]').forEach(b=>b.onclick=()=>void inspectSchedule(b.dataset.scheduleDetail!));
    on("new-schedule", () => newSchedule());
    schedules.forEach((s: Item, i: number) =>
      on("schedule-state-" + i, async () => {
        if (s.enabled) {
          await api("/schedules/" + s.id, "PATCH", { enabled: false });
          await renderSchedules();
          return;
        }
        const modal = dialog(
          "Resume " + s.name,
          `<p>The original targets and template revision will be checked again. No missed work is replayed.</p><label>Next run (your local time)<input type="datetime-local" id="resume-time" value="${localTime()}"></label>${button("resume-confirm", "Resume schedule", true)}`,
        );
        on("resume-confirm", async () => {
          await api("/schedules/" + s.id, "PATCH", {
            enabled: true,
            next_run: timestamp("resume-time"),
          });
          modal.close();
          await renderSchedules();
        });
      }),
    );
    document
      .querySelectorAll<HTMLElement>("[data-schedule-batch]")
      .forEach((el) =>
        el.addEventListener("click", () =>
          showBatch(el.dataset.scheduleBatch!).catch((e: Error) =>
            notify(e.message, true),
          ),
        ),
      );
  }
  async function inspectSchedule(id:string) {
    rememberResource({kind:'schedule',id},()=>inspectSchedule(id));
    const [items,devices]=await Promise.all([api('/schedules'),api('/devices?include_archived=true')]);
    const s=items.find((s:Item)=>s.id===id);if(!s)throw new Error('Schedule is not in the returned inventory');
    const runs=s.runs || [], next=Array.from({length:s.interval_seconds?5:1},(_,i)=>s.next_run+i*s.interval_seconds);
    const pane:HTMLDialogElement=ui.flyout(s.name,detailFacts([['State',s.enabled?'Active':'Paused'],['Owner',s.owner],['Created',date(s.created)],['Updated',date(s.updated)],['Revision',s.revision],['Time zone',Intl.DateTimeFormat().resolvedOptions().timeZone],['Concurrency','One operation per target; busy targets skip the run'],['Catch-up','Missed by more than five minutes: skipped']])+detailSection('Next planned times',s.enabled?next.map(t=>'<p>'+date(t)+'</p>').join(''):'<p>Paused. Resume requires a new future time.</p>')+detailSection('Targets','<div class="resource-related">'+s.operation.device_ids.map((id:string)=>`<a href="${resourceHref(location.hash.slice(1),{kind:'machine',id})}">${esc(devices.find((d:Item)=>d.id===id)?.label || id)} →</a>`).join('')+'</div>')+(s.operation.template_id?detailSection('Template',`<a href="${resourceHref(location.hash.slice(1),{kind:'template',id:s.operation.template_id})}">Inspect pinned template · revision ${esc(s.operation.template_revision)} →</a>`):'')+detailSection('Execution history',runs.map((r:Item)=>`<article class="resource-section">${badge(r.status)} <time>${date(r.due)}</time><p>${esc(r.reason || 'Targets report results individually.')}</p>${r.batch_id?`<a href="${resourceHref(location.hash.slice(1),{kind:'batch',id:r.batch_id})}">Open operation →</a>`:''}</article>`).join('') || '<p>No executions recorded.</p>')+`<div class="toolbar"><button class="secondary" data-schedule-duplicate>Duplicate with review</button>${isAdmin()||s.owner===ui.username()?'<button class="secondary" data-schedule-edit>Edit with review</button>':''}</div>`,{tone:'automation',subtitle:'Schedule · Targets, timing and results'});
    const history=document.createElement('section');history.className='resource-section';pane.querySelector('.resource-body')!.append(history);
    let before:number|null=null;const older=async()=>{const page=await api('/schedules/'+id+'/history'+(before?'?before='+before:''));if(!pane.open)return;history.querySelector('[data-older-runs]')?.remove();history.insertAdjacentHTML('beforeend',(before?'':'<h3>Full execution timeline</h3>')+page.items.map((r:Item)=>`<p>${date(r.due)} · ${esc(r.status)} · ${esc(r.reason || '')}${r.batch_id?` <a href="${resourceHref(location.hash.slice(1),{kind:'batch',id:r.batch_id})}">Inspect operation →</a>`:''}</p>`).join(''));before=page.next_cursor;if(before){const b=document.createElement('button');b.className='secondary';b.dataset.olderRuns='';b.textContent='Load earlier executions';b.onclick=()=>void older().catch((err:Error)=>notify(err.message,true));history.append(b);}};
    const historyButton=document.createElement('button');historyButton.className='secondary';historyButton.textContent='Browse full execution history';historyButton.onclick=()=>{historyButton.remove();void older().catch((err:Error)=>{history.textContent=err.message;});};history.append(historyButton);
    pane.querySelector<HTMLButtonElement>('[data-schedule-duplicate]')!.onclick=()=>void newSchedule({...s.operation,name:s.name+' · copy'});
    pane.querySelector<HTMLButtonElement>('[data-schedule-edit]')?.addEventListener('click',()=>void newSchedule({...s.operation,name:s.name,edit_id:s.id,revision:s.revision,interval_seconds:s.interval_seconds}));
  }
  registerResource('schedule',ref=>inspectSchedule(ref.id));
  const showBatch = (id: string) => ui.showBatch(id);
  async function newSchedule(seed:Item = {}) {
    const [templates, devices] = await Promise.all([
      api("/templates"),
      api("/devices"),
    ]);
    const modal = dialog(
      seed.edit_id ? "Edit schedule" : "New schedule",
      `${seed.template_id?'<p class="resource-note">Parameters start from the current template defaults. Review every value and the exact script before saving this new schedule revision.</p>':''}<label>Name<input id="schedule-name" maxlength="100" placeholder="Daily update inventory"></label><label>Operation<select id="schedule-operation"><option value="scan">Scan available patches</option><option value="inspection.software">Collect software inventory</option><option value="inspection.processes">Collect process inventory</option><option value="inspection.disks">Collect disk inventory</option>${templates.map((t: Item) => `<option value="${t.id}">${esc(t.name)} · ${esc(t.platform)}</option>`).join("")}</select></label><div id="schedule-parameters"></div><div class="form-grid"><label>First run (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)})<input type="datetime-local" id="schedule-first" value="${localTime()}"></label><label>Repeat<select id="schedule-interval"><option value="86400">Every day</option><option value="3600">Every hour</option><option value="604800">Every week</option><option value="0">Once</option></select></label></div><label>When targets are unavailable<select id="schedule-policy"><option value="all">Require every target (skip the whole occurrence)</option><option value="eligible">Run independently on eligible targets; record every exclusion</option></select></label><h3>Target machines</h3><div class="toolbar"><label>Find targets<input id="schedule-search" type="search" placeholder="Machine, site or platform"></label><label>Site<select id="schedule-site"><option value="">All sites</option>${[...new Set(devices.map((d:Item)=>d.site || "Unassigned"))].map(site=>`<option>${esc(site)}</option>`).join("")}</select></label></div><p id="schedule-target-count" role="status"></p><div id="schedule-targets" class="schedule-targets"></div><p>Targets are fixed when saved. The reviewed policy determines whether an unavailable target blocks the whole occurrence or is individually excluded. A changed template pauses the schedule for review.</p>${button("schedule-review", "Review schedule", true)}`,
    );
    modal.classList.add("wide");
    const choices = () => {
      const template = templates.find(
        (t: Item) => t.id === value("schedule-operation"),
      );
      document.getElementById("schedule-parameters")!.innerHTML = template
        ? `<small>Revision ${template.revision} · ${template.timeout / 60} minute limit</small>${template.parameters.map((p: Item, i: number) => `<label>${esc(p.label)}<input id="schedule-param-${i}" value="${esc(p.default)}"></label>`).join("")}`
        : "";
      document.getElementById("schedule-targets")!.innerHTML = devices
        .filter((d: Item) => !template || d.platform === template.platform)
        .map(
          (d: Item) =>
            `<label class="check"><input type="checkbox" data-schedule-target="${d.id}" ${d.approved && !d.revoked && !d.archived && d.telemetry?.capabilities?.managed_operations ? "" : "disabled"}><span>${esc(d.label)}<small>${esc(d.platform)} · ${!d.approved ? "Approval required" : d.revoked ? "Revoked" : d.archived ? "Archived" : !d.telemetry?.capabilities?.managed_operations ? "Agent update required" : d.online ? "Online" : "Offline; unavailable at this preview"} · ${esc(d.site || "Unassigned")}</small></span></label>`,
        )
        .join("");
    };
    if(seed.template_id) (modal.querySelector('#schedule-operation') as HTMLSelectElement).value=seed.template_id;
    if(seed.kind?.startsWith('inspection.')) (modal.querySelector('#schedule-operation') as HTMLSelectElement).value=seed.kind;
    choices();
    const filterTargets=()=>{const labels=[...modal.querySelectorAll<HTMLElement>('#schedule-targets label')];const q=value('schedule-search').toLowerCase(),site=value('schedule-site');labels.forEach(l=>{const id=l.querySelector<HTMLInputElement>('input')!.dataset.scheduleTarget;const d=devices.find((d:Item)=>d.id===id);l.hidden=!(l.textContent || '').toLowerCase().includes(q)||!!site&&(d.site || 'Unassigned')!==site;});document.getElementById('schedule-target-count')!.textContent=labels.filter(l=>!l.hidden).length+' of '+labels.length+' targets visible';};
    on('schedule-search',filterTargets,'input');on('schedule-site',filterTargets,'change');filterTargets();
    if(seed.target_policy) (modal.querySelector('#schedule-policy') as HTMLSelectElement).value=seed.target_policy;
    if(seed.interval_seconds!=null) (modal.querySelector('#schedule-interval') as HTMLSelectElement).value=String(seed.interval_seconds);
    if(seed.name) (modal.querySelector('#schedule-name') as HTMLInputElement).value=seed.name;
    if(seed.device_ids) modal.querySelectorAll<HTMLInputElement>('[data-schedule-target]').forEach(b=>{b.checked=!b.disabled&&seed.device_ids.includes(b.dataset.scheduleTarget);});
    on("schedule-operation",()=>{choices();filterTargets();}, "change");
    on("schedule-review", async () => {
      const template = templates.find(
        (t: Item) => t.id === value("schedule-operation"),
      );
      const body = {
        operation: {
          request_id: crypto.randomUUID(),
          name: value("schedule-name"),
          kind: template ? "template" : value("schedule-operation").startsWith("inspection.") ? value("schedule-operation") : "patch.scan",
          target_policy:value("schedule-policy"),
          device_ids: [
            ...document.querySelectorAll<HTMLInputElement>(
              "[data-schedule-target]:checked",
            ),
          ].map((el) => el.dataset.scheduleTarget),
          template_id: template?.id,
          template_revision: template?.revision,
          parameters: template
            ? Object.fromEntries(
                template.parameters.map((p: Item, i: number) => [
                  p.name,
                  value("schedule-param-" + i),
                ]),
              )
            : {},
          confirmed: true,
        },
        first_run: timestamp("schedule-first"),
        interval_seconds: Number(value("schedule-interval")),
        confirmed: true,
      };
      const review = await api("/schedules/preview", "POST", body);
      const confirm = dialog(
        "Review schedule",
        `<h3>${esc(body.operation.name)}</h3><p>First run ${date(review.first_run)}. ${review.interval_seconds ? "Repeats every " + review.interval_seconds / 3600 + " hours." : "Runs once."}</p><p>Policy: ${body.operation.target_policy === "all" ? "All targets required" : "Run eligible targets independently"}. Times shown in ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}.</p>${review.excluded?.length ? `<div class="callout"><b>Excluded at preview</b>${review.excluded.map((t:Item)=>`<p>${esc(t.label)}: ${esc(t.reason)}</p>`).join("")}</div>` : ""}<p>${review.targets.length} selected machine${review.targets.length === 1 ? "" : "s"}:</p><ul>${review.targets.map((t: Item) => `<li>${esc(t.label)}</li>`).join("")}</ul><details><summary>Review exact scripts</summary>${review.targets.map((t: Item) => `<h3>${esc(t.label)}</h3><pre>${esc(t.script)}</pre>`).join("")}</details><div class="dialog-footer">${button("schedule-create", "Create schedule", true)}</div>`,
      );
      on("schedule-create", async () => {
        await api(seed.edit_id ? "/schedules/"+seed.edit_id : "/schedules", seed.edit_id ? "PUT" : "POST", {...body,...(seed.edit_id?{revision:seed.revision}:{})});
        confirm.close();
        modal.close();
        notify(seed.edit_id?"Schedule updated with a new reviewed start time":"Schedule created");
        if(location.hash.split("?")[0]==="#schedules") await renderSchedules();
      });
    });
  }

  let auditQuery = {
    actor: "",
    action: "",
    device_id: "",
    since: "",
    until: "",
  };
  async function renderAudit() {
    ui.loading("Loading activity…");
    const devices = await api("/devices?include_archived=true");
    content(
      `<div class="management-toolbar audit-filters"><label>Actor<input id="audit-actor" value="${esc(auditQuery.actor)}" placeholder="Any actor"></label><label>Action<input id="audit-action" value="${esc(auditQuery.action)}" placeholder="e.g. schedule"></label><label>Machine<select id="audit-device"><option value="">All machines</option>${devices.map((d: Item) => `<option value="${d.id}" ${auditQuery.device_id === d.id ? "selected" : ""}>${esc(d.label)}${d.archived ? " · archived" : ""}</option>`).join("")}</select></label><label>From<input type="date" id="audit-since" value="${auditQuery.since}"></label><label>Through<input type="date" id="audit-until" value="${auditQuery.until}"></label>${button("audit-filter", "Apply filters")}${button("audit-export", "Export JSON")}${canManage() ? '<a href="#jobs" class="text-link">Job history</a>' : ""}</div><div class="scroll"><table class="audit-table"><thead><tr><th>Event</th><th>Actor</th><th>Machine</th><th>When</th></tr></thead><tbody id="audit-rows"><tr><td colspan="4">${loadingState("Loading activity…")}</td></tr></tbody></table></div><div class="management-footer">${button("audit-more", "Load more")}<span id="audit-count"></span></div>`,
    );
    let next: number | null = null,
      count = 0,
      items: Item[] = [];
    const query = () => {
      const params = new URLSearchParams({
        actor: auditQuery.actor,
        action: auditQuery.action,
        device_id: auditQuery.device_id,
      });
      if (auditQuery.since)
        params.set(
          "since",
          String(new Date(auditQuery.since + "T00:00:00").getTime() / 1000),
        );
      if (auditQuery.until)
        params.set(
          "until",
          String(new Date(auditQuery.until + "T23:59:59.999").getTime() / 1000),
        );
      return params;
    };
    const load = async (more = false) => {
      const params = query();
      if (more && next) params.set("before_id", String(next));
      const result = await api("/audit/events?" + params);
      if (!more) {
        items = [];
        count = 0;
        document.getElementById("audit-rows")!.innerHTML = "";
      }
      items.push(...result.items);
      count += result.items.length;
      next = result.next_cursor;
      document
        .getElementById("audit-rows")!
        .insertAdjacentHTML(
          "beforeend",
          result.items
            .map(
              (a: Item) =>
                `<tr><td><button class="text-link" data-audit-event="${a.id}" title="${esc(a.action)}">${esc(eventLabel(a.action))}</button></td><td>${esc(a.actor)}</td><td>${a.label ? esc(a.label) : '<span class="placeholder">—</span>'}</td><td>${date(a.at)}</td></tr>`,
            )
            .join(""),
        );
      document.querySelectorAll<HTMLButtonElement>('[data-audit-event]').forEach(el => el.onclick = () => {
        const event = items.find(a => String(a.id) === el.dataset.auditEvent); if (!event) return;
        const device = devices.find((d: Item) => d.id === event.device_id);
        const pane = ui.flyout(eventLabel(event.action), detailSection('Event', detailFacts([['Actor',event.actor],['When',date(event.at)],['Machine',event.label],['Event type',event.action],['Event ID',event.id]])) + detailSection('Evidence',detailFacts(Object.entries(event.detail || {}).filter(([,v]) => v !== null && typeof v !== 'object').map(([k,v]) => [k.replaceAll('_',' '),v]) as [string,any][])) + (device ? '<section class="resource-actions"><button data-audit-machine class="primary">Open machine</button></section>' : '') + (event.detail?.job_id ? '<section class="resource-actions"><button data-audit-job class="secondary">Open job result</button></section>' : '') + (event.detail?.batch_id ? '<section class="resource-actions"><button data-audit-batch class="secondary">Open operation</button></section>' : '') + technicalDetail(event.detail), {tone:'automation',subtitle:'Activity · Recorded event'});
        pane.querySelector('[data-audit-job]')?.addEventListener('click',()=>void ui.showJob(event.detail.job_id));
        pane.querySelector('[data-audit-batch]')?.addEventListener('click',()=>void ui.showBatch(event.detail.batch_id));
        pane.querySelector('[data-audit-machine]')?.addEventListener('click',()=>{pane.close();void ui.openDevice(device.id);});
      });
      document.getElementById("audit-more")!.hidden = !next;
      document.getElementById("audit-count")!.textContent =
        count + " events loaded";
    };
    on("audit-more", () => load(true));
    on("audit-filter", async () => {
      auditQuery = {
        ...auditQuery,
        actor: value("audit-actor"),
        device_id: value("audit-device"),
        action: value("audit-action"),
        since: value("audit-since"),
        until: value("audit-until"),
      };
      await load();
    });
    on("audit-export", () => {
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                exported_at: new Date().toISOString(),
                filters: auditQuery,
                scope: "Loaded events only",
                events: items,
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "speck-audit.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Exported " + items.length + " loaded events");
    });
    await load();
  }

  async function renderAccount() {
    ui.loading("Loading account & access…");
    const me = await api("/access/me");
    const keys: Item[] = await api("/access/passkeys");
    const users: Item[] = isAdmin() ? await api("/access/users") : [];
    content(
      `<div class="settings-grid"><article class="panel"><span class="eyebrow">YOUR ACCOUNT</span><h2>${esc(me.username)}</h2><p>${esc(me.role)} · ${me.sessions} active session${me.sessions === 1 ? "" : "s"}</p><div class="management-button-stack">${button("account-password", "Change password")}${button("account-session-inventory", "Inspect active sessions")}${button("account-sessions", "Sign out other sessions")}</div><small>Remote sessions close when password or session access changes.</small></article><article class="panel"><span class="eyebrow">TWO-FACTOR SIGN-IN</span><h2>${me.mfa_enabled ? "Authenticator enabled" : "Add an authenticator"}</h2><p>${me.mfa_enabled ? me.recovery_codes_remaining + " unused recovery codes remain." : "Use an authenticator app to add a second step when you sign in."}</p>${button("account-mfa", me.mfa_enabled ? "Disable two-factor…" : "Set up authenticator", !me.mfa_enabled)}</article></div><article class="panel passkey-panel"><div class="section-head"><div><span class="eyebrow">PASSKEYS</span><h2>A simpler sign-in</h2></div>${button("passkey-add", "Add passkey", true)}</div><p>Use your fingerprint, face, device PIN, or security key. Your password and authenticator remain available as a fallback.</p>${keys.length ? `<ul class="passkey-list">${keys.map((key, i) => `<li><div><b>${esc(key.name)}</b><small>${key.last_used ? "Last used " + esc(new Date(key.last_used * 1000).toLocaleString()) : "Not used yet"}${key.backed_up ? " · Backed up by your provider" : ""}</small></div><div class="actions">${button("passkey-rename-" + i, "Rename")}${button("passkey-remove-" + i, "Remove")}</div></li>`).join("")}</ul>` : '<p class="muted">No passkeys yet. Add one on a device you trust.</p>'}</article>${isAdmin() ? `<div class="section-head"><h2>Operators</h2>${button("account-add", "Add account", true)}</div><div class="scroll"><table class="operators-table" id="operators-table"><thead><tr><th>Account</th><th>Role</th><th>Two-factor</th><th>Passkeys</th><th>Status</th><th></th></tr></thead><tbody>${users.map((u: Item, i: number) => `<tr class="${u.disabled ? "account-disabled" : ""}"><td><button class="text-link" data-operator-detail="${i}">${esc(u.username)}</button>${u.username === me.username ? "<small>You</small>" : ""}</td><td>${esc(u.role)}</td><td>${u.mfa_enabled ? badge("Enabled", true) : badge("Not enabled")}</td><td>${u.passkey_count || 0}</td><td>${badge(u.disabled ? "Disabled" : "Active", !u.disabled)}</td><td>${button("account-edit-" + i, "Manage")}</td></tr>`).join("")}</tbody></table></div>${users.some((u: Item) => u.disabled) ? `<label class="check account-toggle"><input id="account-show-disabled" type="checkbox"> Show ${users.filter((u: Item) => u.disabled).length} disabled account${users.filter((u: Item) => u.disabled).length === 1 ? "" : "s"}</label>` : ""}<p class="muted account-roles">Administrators manage accounts and provider credentials. Operators manage machines, recovery and automation. Viewers can read inventory, alerts and audit history.</p>` : ""}`,
    );
    on('account-session-inventory',async()=>{
      const sessions=await api('/access/sessions');
      ui.flyout('Your active sessions',detailSection('Signed-in sessions',sessions.map((s:Item)=>detailFacts([['Session',s.current?'This session':s.id],['Authentication',s.method],['Role',s.role],['Created',s.created?date(s.created):'Before session metadata collection'],['Last observed request',s.last_seen?date(s.last_seen):'Not recorded'],['Expires',date(s.expires)]])).join(''))+'<p class="resource-note">Last activity is updated at most once per minute. Authentication tokens and CSRF values are never shown. Use Sign out other sessions to revoke the remaining sessions and close remote access.</p>',{tone:'credentials'});
    });
    document.querySelectorAll<HTMLButtonElement>('[data-operator-detail]').forEach(b=>b.onclick=async()=>{
      const u=users[Number(b.dataset.operatorDetail)];
      const pane:HTMLDialogElement=ui.flyout(u.username,detailFacts([['Role',u.role],['State',u.disabled?'Disabled':'Active'],['Authenticator',u.mfa_enabled?'Enabled':'Not enabled'],['Passkeys',u.passkey_count || 0],['Permissions',u.role==='admin'?'Accounts, provider credentials, machine operations and all inventory':u.role==='operator'?'Machine operations, recovery and automation':'Inventory, alerts and audit history']])+'<section class="resource-section" data-operator-activity><h3>Recent activity</h3><p>Reading audit evidence…</p></section><button class="secondary" data-operator-manage>Manage account</button>',{tone:'credentials'});
      pane.querySelector<HTMLButtonElement>('[data-operator-manage]')!.onclick=()=>editUser(u);
      try{const events=await api('/audit/events?actor='+encodeURIComponent(u.username)+'&limit=30');if(pane.open)pane.querySelector('[data-operator-activity]')!.innerHTML='<h3>Recent activity</h3>'+events.items.map((event:Item)=>`<p>${esc(event.action)} · ${date(event.at)}</p>`).join('')+(!events.items.length?'<p>No recorded activity.</p>':'');}catch{if(pane.open)pane.querySelector('[data-operator-activity]')!.textContent='Activity unavailable.';}
    });
    const proof = () =>
      `<label>Current password<input type="password" id="account-current" autocomplete="current-password"></label>${me.mfa_enabled ? '<label>Authenticator or recovery code<input id="account-code" autocomplete="one-time-code" maxlength="40"></label>' : ""}`;
    const addKey = document.getElementById("passkey-add") as HTMLButtonElement;
    addKey.disabled = !passkeysAvailable();
    document.getElementById("account-show-disabled")?.addEventListener("change", (e) =>
      document.getElementById("operators-table")?.classList.toggle("show-disabled", (e.target as HTMLInputElement).checked),
    );
    on("passkey-add", () => {
      const modal = dialog("Add a passkey", `<p>Confirm your account, then follow your device’s prompt.</p><label>Name<input id="passkey-name" maxlength="80" placeholder="e.g. Personal laptop" autocomplete="off"></label>${proof()}${button("passkey-create", "Create passkey", true)}`);
      const controller = new AbortController();
      modal.addEventListener("close", () => controller.abort(), { once: true });
      on("passkey-create", async () => {
        const name = value("passkey-name").trim();
        if (!name) throw new Error("Give this passkey a name.");
        const options = await api("/access/passkeys/options", "POST", { password: value("account-current"), code: value("account-code") });
        if (!modal.open) return;
        const credential = await passkeyCeremony(options.publicKey, true, controller.signal);
        if (!modal.open || !addKey.isConnected) return;
        await api("/access/passkeys/verify", "POST", { challenge_id: options.challenge_id, name, credential });
        modal.close(); notify("Passkey added"); await renderAccount();
      });
    });
    keys.forEach((key, i) => {
      on("passkey-rename-" + i, () => {
        const modal = dialog("Rename passkey", `<label>Name<input id="passkey-name" maxlength="80" value="${esc(key.name)}"></label>${button("passkey-save", "Save name", true)}`);
        on("passkey-save", async () => {
          await api("/access/passkeys/" + key.id, "PATCH", { name: value("passkey-name").trim() });
          modal.close(); await renderAccount();
        });
      });
      on("passkey-remove-" + i, () => {
        const modal = dialog("Remove passkey", `<p>Remove <b>${esc(key.name)}</b>? Sessions opened with this passkey will be signed out. Your remote sessions will close.</p>${proof()}${button("passkey-confirm-remove", "Remove passkey", true)}`);
        on("passkey-confirm-remove", async () => {
          await api("/access/passkeys/" + key.id + "/remove", "POST", { password: value("account-current"), code: value("account-code") });
          modal.close(); notify("Passkey removed"); await renderAccount();
        });
      });
    });
    on("account-password", () => {
      const modal = dialog(
        "Change password",
        `${proof()}<label>New password<input type="password" id="account-new" autocomplete="new-password" minlength="16"><small>At least 16 characters. A short phrase works well.</small></label><label>Repeat new password<input type="password" id="account-repeat" autocomplete="new-password"></label>${button("password-save", "Change password", true)}`,
      );
      on("password-save", async () => {
        if (value("account-new") !== value("account-repeat"))
          throw new Error("The new passwords do not match.");
        await api("/access/password", "POST", {
          password: value("account-current"),
          code: value("account-code"),
          new_password: value("account-new"),
        });
        modal.close();
        notify("Password changed; other sessions signed out");
        await renderAccount();
      });
    });
    on("account-sessions", async () => {
      const r = await api("/access/sessions/revoke", "POST");
      notify("Signed out " + r.revoked + " other sessions");
      await renderAccount();
    });
    on("account-mfa", () => {
      const modal = dialog(
        me.mfa_enabled ? "Disable two-factor sign-in" : "Set up authenticator",
        `${proof()}${button("mfa-start", me.mfa_enabled ? "Disable two-factor" : "Continue", true)}`,
      );
      on("mfa-start", async () => {
        if (me.mfa_enabled) {
          await api("/access/totp/disable", "POST", {
            password: value("account-current"),
            code: value("account-code"),
          });
          modal.close();
          notify("Two-factor sign-in disabled");
          await renderAccount();
          return;
        }
        const setup = await api("/access/totp/setup", "POST", {
          password: value("account-current"),
        });
        modal.close();
        const verify = dialog(
          "Connect your authenticator",
          `<p>Add a time-based account named <b>Speck · ${esc(me.username)}</b> to your authenticator using this setup key.</p><label>Setup key<input readonly class="mono" value="${esc(setup.secret)}" aria-label="Authenticator setup key"></label><small>Keep this key private. Setup expires in 10 minutes.</small><label>Six-digit code<input id="totp-confirm" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>${button("mfa-confirm", "Enable two-factor", true)}`,
        );
        on("mfa-confirm", async () => {
          const result = await api("/access/totp/confirm", "POST", {
            code: value("totp-confirm"),
          });
          verify.close();
          const recovery = dialog(
            "Save your recovery codes",
            `<p>Two-factor sign-in is enabled. Save these codes somewhere safe. Each works once if you lose access to your authenticator, and they are only shown now.</p><pre class="recovery-codes">${result.recovery_codes.map(esc).join("\n")}</pre><label class="check"><input type="checkbox" id="codes-saved"> I saved these codes</label>${button("codes-done", "Done", true)}`,
          );
          on("codes-done", async () => {
            if (!checked("codes-saved"))
              throw new Error("Save the recovery codes before continuing.");
            recovery.close();
            await renderAccount();
          });
        });
      });
    });
    on("account-add", () => editUser());
    users.forEach((u: Item, i: number) =>
      on("account-edit-" + i, () => editUser(u)),
    );
  }
  function editUser(user?: Item) {
    const modal = dialog(
      user ? "Manage " + user.username : "Add account",
      `${user ? "" : '<label>Username<input id="user-name" autocomplete="off" maxlength="100"></label>'}<label>Role<select id="user-role"><option value="operator">Operator</option><option value="viewer">Viewer</option><option value="admin">Administrator</option></select></label><p>Operators can execute commands and manage recovery. Administrators also control accounts and provider credentials. Viewers have read-only inventory, alert and audit access.</p><label>${user ? "Reset password (optional)" : "Initial password"}<input type="password" id="user-password" autocomplete="new-password" minlength="16"><small>At least 16 characters. Share it privately; each person can change it in their account.</small></label>${user ? `<label class="check"><input id="user-reset-passkeys" type="checkbox"> Remove all passkeys (${user.passkey_count || 0})</label><label class="check"><input id="user-disabled" type="checkbox" ${user.disabled ? "checked" : ""}> Disable account</label><p>Saving signs this person out of all sessions. Disabling access also pauses their schedules.</p>` : ""}${button("user-save", user ? "Save account" : "Create account", true)}`,
    );
    (document.getElementById("user-role") as HTMLSelectElement).value =
      user?.role || "operator";
    on("user-save", async () => {
      if (user)
        await api("/access/users/" + user.id, "PATCH", {
          role: value("user-role"),
          disabled: checked("user-disabled"),
          reset_passkeys: checked("user-reset-passkeys"),
          new_password: value("user-password") || null,
        });
      else
        await api("/access/users", "POST", {
          username: value("user-name"),
          role: value("user-role"),
          password: value("user-password"),
        });
      modal.close();
      notify(user ? "Account updated" : "Account created");
      await renderAccount();
    });
  }
  async function settingsPanel() {
    document
      .getElementById("content")!
      .insertAdjacentHTML(
        "afterbegin",
        `<div class="settings-grid"><article class="panel"><span class="eyebrow">ACCESS</span><h2>Your account${isAdmin() ? " & operators" : ""}</h2><p>Passwords, two-factor sign-in and active sessions.</p>${button("open-accounts", "Manage access")}</article><article class="panel"><span class="eyebrow">FLEET LIFECYCLE</span><h2>Archived machines</h2><p>Review retired instances or return them to the fleet.</p>${button("open-archives", "View archive")}</article></div>`,
      );
    on("open-accounts", () => {
      location.hash = "account";
    });
    on("open-archives", async () => {
      const devices = (await api("/devices?include_archived=true")).filter(
        (d: Item) => d.archived,
      );
      const modal = dialog(
        "Archived machines",
        devices.length
          ? `<div class="archive-list">${devices.map((d: Item, i: number) => `<article><div><b>${esc(d.label)}</b><small>${esc(d.platform)} · ${d.revoked ? "Credential revoked" : "Archived"}</small></div>${!d.revoked ? button("unarchive-" + i, "Restore to fleet") : ""}</article>`).join("")}</div>`
          : "<p>No archived machines.</p>",
      );
      devices.forEach((d: Item, i: number) =>
        on("unarchive-" + i, async () => {
          await api("/devices/" + d.id + "/archive", "PUT", {
            archived: false,
          });
          modal.close();
          notify(d.label + " returned to the fleet");
        }),
      );
    });
  }
  async function updateIndicator() {
    const data = await api("/alerts?limit=1");
    const count = data.counts.unacknowledged || 0;
    document.querySelectorAll<HTMLButtonElement>('nav [data-page="alerts"]').forEach((button) => {
      button.querySelector(".alert-count")?.remove();
      if (count)
        button.insertAdjacentHTML(
          "beforeend",
          `<b class="alert-count" aria-label="${count} unacknowledged">${count > 99 ? "99+" : count}</b>`,
        );
    });
  }
  return {
    updateIndicator,
    renderAlerts,
    renderSchedules,
    newSchedule,
    renderAudit,
    renderAccount,
    settingsPanel,
    devicePanel,
  };
}
