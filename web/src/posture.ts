type Item = Record<string, any>;
export const PATCH_FRESH_SECONDS=86400;
export function patchPosture(device:Item, report:Item | undefined, now=Date.now()/1000) {
  if(!device.approved || device.revoked || device.archived) return {state:'Ineligible',reason:device.archived?'Archived identity':device.revoked?'Agent access revoked':'Agent approval required',eligible:false};
  if(!['windows','linux'].includes(device.platform) || !device.telemetry?.capabilities?.managed_operations) return {state:'Unsupported',reason:'This agent does not report managed update support',eligible:false};
  const state=!report?'Never scanned':!report.scanned || now-report.scanned>PATCH_FRESH_SECONDS?'Stale scan':report.report?.total>0?'Updates available':'Current';
  return {state, reason:!device.online?'Agent is offline':state==='Stale scan'?'Last inventory is more than 24 hours old':state==='Current'?'No updates in a scan less than 24 hours old':'',eligible:!!device.online};
}
