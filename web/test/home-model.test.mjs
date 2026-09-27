import test from 'node:test';
import assert from 'node:assert/strict';
import { relationships, matchingRelationships, networkEvidence } from '../src/home-model.ts';

const guest = { id: 'agent-1', label: 'Portal', has_endpoint_agent: true, identity_evidence: ['Hardware UUID'], resources: [{ provider: 'proxmox', kind: 'qemu', connection_id: 'a', connection_name: 'Clinic', node: 'pve-1', name: 'Portal VM', addresses: ['192.0.2.20'] }] };
const host = (connection, id) => ({ id, label: 'pve-1', has_endpoint_agent: false, resources: [{ provider: 'proxmox', kind: 'node', connection_id: connection, id: 'pve-1' }] });
test('host links are scoped to their connection and network links to machine identity', () => {
  const rows = relationships([guest, host('a', 'right'), host('b', 'wrong')], [{id:'other',label:'Portal',lan:[{ip:'192.0.2.20',source:'unifi_mac'}]}]);
  const row = rows.find(r => r.machine.id === guest.id);
  assert.equal(row.hosts[0].machineId, 'right');
  assert.equal(row.network, undefined);
  assert.equal(networkEvidence(row), 'No UniFi link');
  assert.equal(row.linked, true);
});
test('same name and addresses do not create a confirmed identity; conflicts and stale data stay explicit', () => {
  const rows = relationships([{...guest, identity_evidence:[]}, {...guest,id:'conflict',identity_issues:['Duplicate UUID']}, {...guest,id:'stale',stale:true}, {...guest,id:'archived',archived:true}]);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(r => r.machine.id === guest.id).linked, false);
  assert.equal(rows.find(r => r.machine.id === 'conflict').linked, false);
  assert.deepEqual(matchingRelationships(rows, '', 'review').map(r => r.machine.id).sort(), ['conflict','stale']);
});
test('search covers provider hosts, aliases, IPs and DNS without changing identity', () => {
  const rows = relationships([guest], [{id:guest.id,lan:[{ip:'192.0.2.20',source:'unifi_mac'}],public:[{ip:'203.0.113.5',via:'unifi_nat'}],dns:[{fqdn:'portal.example.com'}]}]);
  for (const query of ['pve-1', '192.0.2.20', '203.0.113.5', 'portal.example.com', 'CLINIC portal']) assert.equal(matchingRelationships(rows, query).length, 1);
  assert.equal(matchingRelationships(rows, 'missing.example.com').length, 0);
  assert.equal(networkEvidence(rows[0]), 'MAC matched');
  const reported = relationships([guest], [{id:guest.id,lan:[{ip:'192.0.2.20',source:'reported',client:'Portal'}]}]);
  assert.equal(networkEvidence(reported[0]), 'No UniFi link');
});
test('host connectors do not count as endpoint automation coverage', () => {
  const rows = relationships([{...host('a','host'), has_speck_agent:true}, guest]);
  assert.equal(matchingRelationships(rows, '', 'missing')[0].machine.id, 'host');
});
