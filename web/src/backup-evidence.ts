type Item = Record<string,any>;
const stamp = (value:any):number => typeof value==='number'?value:Date.parse(value || '')/1000;
const success = (state:any) => /^(completed|complete|succeeded|success|passed|verified)$/i.test(String(state));
export function backupEvidence(sections:Item, agent:Item = {}, now=Date.now()/1000) {
  const backups:Item[] = sections.backup?.data?.rows || [];
  const snapshots:Item[] = sections.snapshot?.data?.rows || [];
  const latest=(rows:Item[],pick:(r:Item)=>any)=>rows.map(pick).map(stamp).filter(Number.isFinite).sort((a,b)=>b-a)[0] ?? null;
  const successful = latest(backups.filter(b=>success(b.status)),b=>b.ended_at || b.completed_at || b.backup_ended_at);
  const snapshot = latest(snapshots,b=>b.backup_ended_at || b.created_at);
  const verified = latest(snapshots.filter(s=>success(s.verify_fs_status)||success(s.verify_boot_status)),s=>s.backup_ended_at || s.created_at);
  const recorded=stamp(agent.last_backup || agent.last_backup_at || agent.backup_ended_at);
  const candidates=[successful,snapshot,Number.isFinite(recorded)?recorded:null].filter((s):s is number=>s!==null);
  const latestPoint=candidates.length?Math.max(...candidates):null;
  const interval=Number(agent.backup_schedule?.interval_in_minutes)*60;
  return {successful,snapshot,verified,latestPoint,
    age:latestPoint?Math.max(0,now-latestPoint):null,
    failed:backups.filter(b=>/failed|error/i.test(b.status || '')).length,
    state:latestPoint===null?'No recovery point reported':agent.backup_schedule_active && interval>0 && now-latestPoint>interval*2?'Older than two backup intervals':'Recovery point recorded',
    source:successful&&successful===latestPoint?'Successful backup job':snapshot&&snapshot===latestPoint?'Provider snapshot inventory':'Protected-system metadata',
    complete:sections.backup?.data?.next_offset==null && sections.snapshot?.data?.next_offset==null,
  };
}
