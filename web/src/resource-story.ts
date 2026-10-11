type Item = Record<string, any>;
export const escapeDetail = (value: any): string => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const e = escapeDetail;
const obj = (value: any): Item => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const items = (value: any): any[] => Array.isArray(value) ? value : [];
const present = (value: any) => value !== undefined && value !== null && value !== '';
const plain = (value: any): string => !present(value) ? 'Not reported' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : Array.isArray(value) ? value.map(plain).join('\n') || 'None' : String(value);
export function capacity(value: any): string {
  if (!present(value) || !Number.isFinite(Number(value))) return 'Not reported';
  let amount = Number(value), i = 0;
  const labels = ['B','KB','MB','GB','TB','PB'];
  while (amount >= 1024 && i < labels.length - 1) { amount /= 1024; i++; }
  return `${Number(amount.toFixed(1))} ${labels[i]}`;
}
export function detailDate(value: any): string {
  if (!present(value)) return 'Not reported';
  const iso = typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value) ? value+'Z' : value;
  const date = new Date(typeof iso === 'number' ? iso*1000 : iso);
  return Number.isNaN(date.getTime()) ? 'Not reported' : date.toLocaleString();
}
export const detailStatus = (value: any) => {
  const label = String(value || 'Not reported');
  const tone = /^(running|online|connected|healthy|complete|completed|success|successful|succeeded|passed|verified)$/i.test(label) ? 'good' : /^(failed|error|unhealthy)$/i.test(label) ? 'bad' : 'neutral';
  return `<span class="badge ${tone}">${e(label.replaceAll('_',' '))}</span>`;
};
export const detailFacts = (rows: [string, any][], links: Record<string, string> = {}) => `<dl class="resource-facts">${rows.map(([key,value]) => `<div><dt>${e(key)}</dt><dd>${links[key] ?? e(plain(value))}</dd></div>`).join('')}</dl>`;
export const detailSection = (title: string, html: string) => `<section class="resource-section"><h3>${e(title)}</h3>${html}</section>`;
const facts = detailFacts, section = detailSection;
const metrics = (rows: [string, any, string?][]) => `<div class="resource-metrics">${rows.map(([key,value,note]) => `<div><small>${e(key)}</small><strong>${e(plain(value))}</strong>${note ? `<small>${e(note)}</small>` : ''}</div>`).join('')}</div>`;
export const detailHero = (kind: string, status: any, description: string, rows: [string, any, string?][] = []) => `<section class="resource-hero"><div class="resource-eyebrow">${e(kind)} ${status ? detailStatus(status) : ''}</div><p>${e(description)}</p>${rows.length ? metrics(rows) : ''}</section>`;

/** Provider diagnostics stay available, recursively readable and locally redacted. */
export function technicalFields(value: any, depth = 0): string {
  if (depth > 6) return '<span class="resource-note">Additional nested fields omitted.</span>';
  if (Array.isArray(value)) {
    if (!value.length) return 'None';
    if (value.every(v => v === null || typeof v !== 'object')) return e(value.map(plain).join(' · '));
    return value.slice(0,50).map((v,i) => `<details class="resource-list-item"><summary>Item ${i+1}</summary>${technicalFields(v,depth+1)}</details>`).join('') + (value.length>50 ? `<p class="resource-note">Showing 50 of ${value.length} items.</p>` : '');
  }
  if (value && typeof value === 'object') return `<dl class="resource-fields">${Object.entries(value).map(([key,v]) => `<dt>${e(key.replaceAll('_',' '))}</dt><dd>${/password|secret|token|private.?key|credential|user.?data|websocket.?uri|ticket/i.test(key) ? 'Hidden' : v && typeof v === 'object' ? `<details><summary>${Array.isArray(v) ? v.length+' items' : 'View fields'}</summary>${technicalFields(v,depth+1)}</details>` : e(plain(v))}</dd>`).join('')}</dl>`;
  return e(plain(value));
}
export const technicalDetail = (data: any) => `<details class="resource-technical"><summary>Technical details</summary><p class="resource-note">Provider fields for troubleshooting.</p>${technicalFields(data)}</details>`;

export function relatedResources(resource: Item, inventory: Item[]): Item[] {
  return resource.provider === 'proxmox' && resource.kind === 'node'
    ? inventory.filter(r => r.provider === 'proxmox' && r.connection_id === resource.connection_id && r.node === resource.node && ['qemu','lxc'].includes(r.kind)) : [];
}
const resources = (rows: Item[], attr: string) => `<div class="resource-related">${rows.slice(0,30).map((r,i) => `<button type="button" ${attr}="${i}"><span><b>${e(r.name || r.hostname || r.display_name || r.id)}</b><small>${e(r.kind==='lxc' ? 'Container' : r.kind==='qemu' ? 'Virtual machine' : r.kind || 'Resource')}${r.id ? ' · '+e(r.id) : ''}</small></span>${detailStatus(r.status)}<span aria-hidden="true">→</span></button>`).join('')}</div>${rows.length>30 ? `<p class="resource-note">Showing 30 of ${rows.length}. Open Infrastructure for the full inventory.</p>` : ''}`;

export function infrastructureStory(r: Item, detail: Item | null, inventory: Item[] = [], actions = ""): string {
  const c = obj(detail?.configuration), s = obj(detail?.status), specs = obj(c.specs);
  const types: Item = {node:'Proxmox host',qemu:'Virtual machine',lxc:'Container',instance:'Cloud instance',box:'Backup appliance',protected:'Protected system',virt:'Recovered VM'};
  let hero = '', body = '';
  const state = s.status || c.status || r.status;
  if (r.provider === 'linode') {
    hero = detailHero('Linode · Cloud instance',state,`${c.region || r.node || 'Region not reported'} · ${c.type || 'Instance plan not reported'}`, [
      ['Processors',specs.vcpus ?? '—','virtual CPUs'],
      ['Memory',present(specs.memory) ? capacity(specs.memory*1048576) : capacity(r.max_memory),'allocated'],
      ['Storage',present(specs.disk) ? capacity(specs.disk*1048576) : capacity(r.max_disk),'allocated'],
    ]);
    body += section('Network', facts([['IPv4 addresses', c.ipv4 || r.addresses],['IPv6 address',c.ipv6],['Region',c.region || r.node],['Transfer allowance',present(specs.transfer) ? specs.transfer+' GB / month' : null]]));
    const backup = obj(c.backups);
    body += section('Backup protection', facts([['Provider backups',present(backup.enabled) ? backup.enabled ? 'Enabled' : 'Disabled' : null],['Last successful backup',detailDate(backup.last_successful)],['Backup day',backup.schedule?.day],['Backup window',backup.schedule?.window]]));
    const automatic = items(detail?.backups?.automatic);
    if (automatic.length) body += section('Recent backups', `<div class="resource-related">${automatic.slice(0,4).map(b => `<div><span><b>${e(b.label || b.type || 'Backup')}</b><small>${e(detailDate(b.finished || b.created))}${b.disks ? ' · '+e(capacity(items(b.disks).reduce((n,d)=>n+(d.size || 0)*1048576,0))) : ''}</small></span>${detailStatus(b.status)}</div>`).join('')}</div>`);
    body += section('Configuration', facts([['Operating system image',c.image],['Hypervisor',c.hypervisor],['Automatic recovery (watchdog)',c.watchdog_enabled],['Disk encryption',c.disk_encryption],['Created',detailDate(c.created)],['Tags',c.tags]]));
  } else if (r.provider === 'proxmox' && r.kind === 'node') {
    const ram = obj(s.memory), cpus = obj(s.cpuinfo), guests = relatedResources(r,inventory);
    const used = ram.used ?? s.mem ?? r.memory, total = ram.total ?? s.maxmem ?? r.max_memory;
    const cpu = s.cpu ?? r.cpu;
    hero = detailHero('Proxmox · Host',state,`${r.connection_name || 'Proxmox cluster'} · Guests on this host share its compute, storage and networks.`, [
      ['CPU',typeof cpu === 'number' ? `${Math.round(cpu*100)}%` : '—',cpus.cpus ? cpus.cpus+' logical processors' : 'utilization'],
      ['Memory',present(total) ? capacity(total) : '—',present(used) ? capacity(used)+' used' : 'total capacity'],
      ['Guests',guests.length || '—',guests.length ? guests.filter(g=>g.status==='running').length+' running in loaded inventory' : 'No guests in loaded inventory'],
    ]);
    body += section('Host', facts([['Processor',cpus.model],['Kernel',s.kversion || s.current_kernel?.release],['Uptime',present(s.uptime) ? `${Math.floor(s.uptime/86400)} days · ${Math.floor(s.uptime%86400/3600)} hours` : null],['Management',r.management==='host_agent' ? 'Speck host connector' : 'Provider connection']]));
    const storage = items(detail?.storage);
    if (storage.length) body += section('Storage', `<div class="resource-related">${storage.map((v,i)=>`<button data-host-detail="storage" data-host-index="${i}"><span><b>${e(v.storage || v.name)}</b><small>${e(v.type || 'Storage')} · ${e(capacity(v.used))} used / ${e(capacity(v.total))}</small></span>${detailStatus(v.active===1 ? 'Available' : v.active===0 ? 'Inactive' : 'Not reported')}</button>`).join('')}</div>`);
    const networks = items(detail?.network);
    if (networks.length) body += section('Host networks', '<div class="resource-related">'+networks.map((v,i)=>`<button data-host-detail="network" data-host-index="${i}"><span><b>${e(v.iface || 'Interface')}</b><small>${e([v.cidr || v.address,v.type,v.bridge_ports].filter(Boolean).join(' · '))}</small></span>→</button>`).join('')+'</div>');
    const tasks=items(detail?.recent_tasks);
    body += section('Recent host activity',tasks.length?'<div class="resource-related">'+tasks.map((t,i)=>`<button data-host-detail="recent_tasks" data-host-index="${i}"><span><b>${e(t.type || 'Task')}${t.id?' · '+e(t.id):''}</b><small>${e(detailDate(t.starttime))} · ${e(t.user)}</small></span>${detailStatus(t.status || 'Running')}<span>→</span></button>`).join('')+'</div>':'<p class="resource-note">No recent host tasks reported.</p>');
    body += section('Hosted guests',guests.length ? resources(guests,'data-related-resource') : '<p class="resource-note">No guests for this host are present in the loaded inventory.</p>');
  } else {
    hero = detailHero(`${r.provider || 'Provider'} · ${types[r.kind] || 'Resource'}`, state, `${r.connection_name || 'Provider connection'}${r.node ? ' · '+r.node : ''}`, [
      ['Memory',capacity(r.max_memory),'allocated'],['Storage',capacity(r.max_disk),'capacity'],['Access',r.agent ? 'Speck' : 'Provider',r.agent ? 'endpoint linked' : 'management connection'],
    ]);
    body += section('Identity & location',facts([['Resource ID',r.id],['Host / appliance',r.node],['Hostname',c.hostname || r.name],['Operating system',[c.os || c.platform,c.os_version].filter(Boolean).join(' ')],['Last seen',detailDate(c.last_seen_at)],['Addresses',c.ip_addresses || r.addresses]]));
    if (items(detail?.agents).length) body += section('Protected systems',`<div class="resource-related">${items(detail?.agents).slice(0,30).map(a=>`<div><span><b>${e(a.display_name || a.hostname || a.agent_id)}</b><small>${e([a.os || a.platform,a.os_version].filter(Boolean).join(' '))}</small></span>${detailStatus(a.status || a.service_status)}</div>`).join('')}</div>`);
  }
  const unavailable = Object.entries(detail?.availability || {}).filter(([,v]:[string,any])=>v.state==='unavailable');
  return hero + actions + (unavailable.length ? `<p class="resource-notice">Not reported by the provider: ${e(unavailable.map(([k])=>k.replaceAll('_',' ')).join(', '))}. Available details remain visible.</p>` : '') + body;
}

export const slideName = (r: Item) => r.display_name || r.name || r.hostname || (r.backup_id && r.started_at ? 'Backup · '+detailDate(r.started_at) : null) || (r.snapshot_id && r.backup_ended_at ? 'Snapshot · '+detailDate(r.backup_ended_at) : null) || r.backup_id || r.snapshot_id || r.virt_id || r.device_id || r.agent_id || r.id || 'Resource';
export const slideKinds: Item = {agent:'Protected system',device:'Backup appliance',snapshot:'Snapshot',backup:'Backup job',network:'Recovery network','restore/virt':'Recovered VM','restore/file':'File restore','restore/image':'Image export'};
export function slideStory(kind: string, r: Item): string {
  const when = r.last_seen_at || r.backup_ended_at || r.ended_at || r.created_at;
  const state = r.status || r.state || r.service_status;
  let result = detailHero('Slide · '+(slideKinds[kind] || 'Resource'),state,
    kind==='agent' ? 'Backup protection, reported platform and network identity in one place.' : kind==='device' ? 'Appliance capacity and the systems it protects.' : 'Follow this resource from its source to its outcome.');
  if (kind==='device') result += section('Appliance', facts([['Model',r.hardware_model_name || r.model],['Serial number',r.serial_number],['Used storage',capacity(r.storage_used_bytes)],['Total storage',capacity(r.storage_total_bytes)],['Last seen',detailDate(when)],['Service state',r.service_status || state]])) + section('Protected systems','<div data-slide-protected><p class="resource-note">Reading protection inventory…</p></div>');
  else if (kind==='agent') {
    const schedule = obj(r.backup_schedule);
    result += section('Backup schedule',facts([['Scheduled backups',r.backup_schedule_active],['Cadence',schedule.interval_in_minutes ? 'Every '+schedule.interval_in_minutes+' minutes' : null],['Window',present(schedule.start_hour) && present(schedule.end_hour) ? schedule.start_hour+':00 – '+schedule.end_hour+':00' : null],['Time zone',r.timezone],['Local retention',r.local_retention_policy?.retention_policy_name],['Encryption',r.encryption_algorithm]]));
    result += '<div data-protection-summary>'+section('Protection',facts([['Last backup',detailDate(r.last_backup || r.last_backup_at || r.backup_ended_at)],['Agent last seen',detailDate(r.last_seen_at)],['Service state',r.service_status || state],['Backup agent version',r.agent_version]]))+'</div>';
    result += section('Reported system',facts([['Hostname',r.hostname],['Operating system',[r.os || r.platform || r.agent_type,r.os_version].filter(Boolean).join(' ')],['IP addresses',items(r.addresses).flatMap(a=>items(a.ips)).length ? items(r.addresses).flatMap(a=>items(a.ips)) : r.ip_addresses],['MAC addresses',items(r.addresses).map(a=>a.mac).filter(Boolean)]]));
    const alerts = items(r.alert_configs).filter(a=>a.alert_active);
    if (alerts.length) result += `<p class="resource-notice">${alerts.length} provider alert rule${alerts.length===1?' is':'s are'} enabled. Configuration describes which alerts are enabled, not whether a failure is active.</p>`;
  } else if (kind==='network') {
    result += section('Recovery network',facts([['Type',r.type],['Router / subnet',r.router_prefix || r.cidr || r.subnet],['Internet access',r.internet],['DHCP',r.dhcp],['DHCP range',[r.dhcp_range_start,r.dhcp_range_end].filter(Boolean).join(' – ')],['DNS servers',r.nameservers],['WireGuard',r.wg],['Connected recovery VMs',items(r.connected_virt_ids).length]]));
  } else {
    result += section('Progress & timing',facts([['State',state],['Started',detailDate(r.started_at || r.backup_started_at || r.created_at)],['Completed',detailDate(r.ended_at || r.backup_ended_at || r.completed_at)],['Size',capacity(r.size_bytes ?? r.bytes ?? r.size)],['Boot verification',r.verify_boot_status],['Filesystem verification',r.verify_fs_status],['Verification time',detailDate(r.verified_at || r.verify_boot_at)]]));
    if (kind==='restore/virt') result += section('Recovered VM',facts([['Processors',r.cpu_count],['Memory',present(r.memory_in_mb) ? capacity(r.memory_in_mb*1048576) : null],['IP address',r.ip_address],['Network source',r.network_source],['Expires',detailDate(r.expires_at)],['Purpose',r.purpose]]));
    if (kind.startsWith('restore/')) result += `<p class="resource-note">This is a recovery resource. Its state does not establish application recovery or validation of the original system.</p>`;
  }
  const links = [['device','device_id','Backup appliance'],['agent','agent_id','Protected system'],['snapshot','snapshot_id','Source snapshot']].filter(([k,id])=>k!==kind&&r[id]);
  if (links.length) result += section('Related resources', `<div class="resource-related">${links.map(([k,id,label])=>`<button type="button" data-slide-related="${k}" data-resource-id="${e(r[id])}"><span><b>${label}</b><small>${e(r[id])}</small></span><span aria-hidden="true">→</span></button>`).join('')}</div>`);
  return result + technicalDetail(r);
}
