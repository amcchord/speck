type Item = Record<string, any>;
export const columns: Record<string, {label: string; width: number; className?: string}> = {
  name: {label: 'Machine', width: 230, className: 'machine-cell'},
  status: {label: 'Status', width: 95, className: 'status-cell'},
  client: {label: 'Client', width: 170},
  agent: {label: 'Speck agent', width: 170},
  location: {label: 'Location / host', width: 210},
  app: {label: 'Active app', width: 190, className: 'app-cell'},
  cpu: {label: 'CPU', width: 70, className: 'util-cell cpu-cell'},
  memory: {label: 'RAM', width: 70, className: 'util-cell ram-cell'},
  address: {label: 'IP address', width: 160, className: 'network-cell mono'},
  provider: {label: 'Provider', width: 130}, kind: {label: 'Type', width: 130},
  site: {label: 'Site', width: 150}, seen: {label: 'Last report', width: 170},
  preview: {label: 'Screen preview', width: 130, className: 'screen-cell'},
};
export type FleetPreferences = {order: string[]; visible: string[]; widths: Record<string, number>; sort: string; direction: string; highlight_agents: boolean; agent_filter: string};
export const defaultPreferences = (): FleetPreferences => ({order: Object.keys(columns), visible: ['name','status','client','agent','location','app','cpu','memory','address'], widths: {}, sort: 'name', direction: 'asc', highlight_agents: false, agent_filter: 'all'});
export const hasEndpoint = (d: Item) => d.has_endpoint_agent !== false;
export const hasAgent = (d: Item) => d.has_speck_agent ?? hasEndpoint(d);
export const selectableMachine = (d: Item) => hasEndpoint(d) && d.approved && !d.archived && !d.revoked;
export const machineState = (d: Item) => hasEndpoint(d) && !d.approved ? 'Review' : d.state ? d.state[0].toUpperCase() + d.state.slice(1) : d.online ? 'Online' : 'Offline';
export const agentLabel = (d: Item) => d.agent_status || (hasEndpoint(d) ? `Endpoint agent ${d.online ? 'online' : 'offline'}` : 'No Speck agent');
export const kindLabel = (d: Item) => ({qemu:'VM', lxc:'Container', node:'Host', virt:'Slide VM', box:'Slide box', protected:'Protected machine', instance:'Cloud instance', endpoint:'Endpoint'}[d.kind as string] || 'Endpoint');
export const cpu = (d: Item) => d.telemetry?.cpu_percent ?? d.cpu_percent;
export const memory = (d: Item) => d.telemetry?.memory?.usedPercent ?? d.memory_percent;
export function sortMachines(rows: Item[], key: string, direction: string, address: (d: Item) => string) {
  const val = (d: Item): string | number | null => ({name:d.label,status:machineState(d),client:d.client_name || 'Unassigned',agent:Number(hasAgent(d)),location:d.location || d.site || '',app:d.telemetry?.active_app?.title || d.telemetry?.last_active_app?.title || '',cpu:cpu(d),memory:memory(d),address:address(d),provider:d.provider || 'Speck',kind:kindLabel(d),site:d.site || '',seen:d.last_seen,preview:Number(!!d.preview?.available)}[key] ?? null);
  return rows.sort((a,b) => { const av=val(a),bv=val(b); if(av==null || bv==null) return av==null ? bv==null ? a.label.localeCompare(b.label) : 1 : -1; const n=typeof av==='number' && typeof bv==='number' ? av-bv : String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'}); return n*(direction==='desc' ? -1 : 1) || a.label.localeCompare(b.label); });
}
