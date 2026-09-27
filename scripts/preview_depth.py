"""Synthetic integration-depth fixtures. No external calls or mutations."""
import re


def depth_fixture(route, query, now):
    scope = {'console_id': 'console-1', 'site_id': 'site-1'}
    switch = {'id': 'switch-1', 'name': 'Office switch', 'model': 'USW Pro 24 PoE', 'ipAddress': '192.0.2.2', 'macAddress': '02:00:00:00:10:01', 'state': 'ONLINE', 'supported': True, 'firmwareVersion': '7.2.123', 'features': ['switching'], 'firmwareUpdatable': False}
    ap = {'id': 'ap-1', 'name': 'Lobby access point', 'model': 'U6 Pro', 'ipAddress': '192.0.2.3', 'macAddress': '02:00:00:00:10:02', 'state': 'ONLINE', 'supported': True, 'firmwareVersion': '7.2.123', 'features': ['accessPoint'], 'parent_id': 'switch-1', 'parent_port': 4}
    clients = [dict(scope, name='Reception workstation', ip='192.0.2.24', mac='02:00:00:00:00:24', uplink_id='switch-1', uplink_name='Office switch', port=5, state='online', type='WIRED', link_mbps=1000, last_seen=now, is_managed_gateway=False), dict(scope, name='Lobby camera', ip='192.0.2.31', mac='02:00:00:00:00:31', uplink_id='switch-1', uplink_name='Office switch', port=8, state='online', type='WIRED', last_seen=now), dict(scope, name='Guest laptop', ip='192.0.2.32', mac='02:00:00:00:00:32', uplink_id='ap-1', uplink_name='Lobby access point', state='online', type='WIRELESS', signal_dbm=-56, last_seen=now, is_managed_gateway=False)]
    if re.fullmatch(r'/api/unifi/sites/[^/]+/[^/]+/devices', route):
        return {'devices': [switch, ap], 'checked_at': now, 'truncated': False}
    if re.fullmatch(r'/api/unifi/sites/[^/]+/[^/]+/devices/[^/]+', route):
        is_ap = route.endswith('/ap-1')
        ports = [{'idx': i, 'state': 'UP' if i in (4, 5, 8, 24) else 'DOWN', 'connector': 'SFPPLUS' if i == 24 else 'RJ45', 'maxSpeedMbps': 10000 if i == 24 else 2500, 'speedMbps': {4: 2500, 5: 1000, 8: 100, 24: 10000}.get(i, 0),
                  'poe': {'enabled': True, 'state': 'UP' if i in (4, 8) else 'DOWN', 'standard': '802.3at'},
                  'observation': {'name': {4: 'Lobby Wi-Fi', 5: 'Reception', 8: 'Lobby camera'}.get(i, 'Port '+str(i)), 'poe_power': {4: 6.2, 8: 12.7, 24: None}.get(i, 0), 'rx_bytes': 182700000, 'tx_bytes': 42300000, 'rx_errors': 0, 'tx_errors': 0, 'rx_dropped': 0, 'tx_dropped': 0, 'stp_state': 'forwarding'}} for i in range(1, 25)]
        return {'device': (ap if is_ap else switch) | {'features': {'accessPoint': {}} if is_ap else {'switching': {}}, 'interfaces': {'ports': [] if is_ap else ports, 'radios': [{'frequencyGHz': 5, 'wlanStandard': '802.11ax', 'channel': 36, 'channelWidthMHz': 80}] if is_ap else []}},
                'ports': [] if is_ap else ports, 'clients': clients[2:] if is_ap else clients[:2], 'children': [] if is_ap else [ap], 'descendants': [] if is_ap else [ap], 'downstream_clients': [] if is_ap else clients[2:], 'upstream': switch if is_ap else None, 'upstream_port': 4 if is_ap else None,
                'statistics': {'cpuUtilizationPct': 8.2, 'memoryUtilizationPct': 42.7, 'uptimeSec': 234892, 'lastHeartbeatAt': '2026-09-27T18:00:00Z', 'uplink': {'rxRateBps': 24000000, 'txRateBps': 7000000}}, 'observations_available': True, 'clients_available': True, 'truncated': False, 'checked_at': now}
    if route == '/api/unifi/operations':
        return []
    if route == '/api/infrastructure/connections/l1/resources/instance/9001':
        return {'resource': {'id':'9001','name':'shop-storefront','connection_id':'l1','connection_name':'Example cloud','kind':'instance','provider':'linode'},'configuration': {'status':'running','region':'us-east','type':'g6-dedicated-4','specs':{'vcpus':4,'memory':8192,'disk':163840},'ipv4':['198.51.100.40']}}
    if route.endswith('/explore') and '/infrastructure/connections/' in route:
        if '/protected/' in route:
            aid=route.split('/')[-2]
            return {'checked_at': now, 'sections': {k: {'state': 'available', 'data': {'rows': [dict(agent_id=aid, backup_id='backup-1', snapshot_id='snapshot-1', started_at='2026-09-27T17:00:00Z', ended_at='2026-09-27T17:06:00Z', backup_ended_at='2026-09-27T17:06:00Z', status='completed', verify_fs_status='passed')], 'next_offset': None}} for k in ('backup','snapshot')}}
        return {'checked_at': now, 'sections': {k: {'state': 'available', 'data': {'data': v, 'pages': 1}} for k,v in {
            'disks': [{'id': 11, 'label': 'Debian system disk', 'size': 160000, 'status': 'ready', 'filesystem': 'ext4', 'disk_encryption': 'enabled'}],
            'configs': [{'id': 21, 'label': 'Production boot', 'root_device': '/dev/sda', 'kernel': 'linode/grub2', 'virt_mode': 'paravirt', 'devices': {'sda': {'disk_id': 11}}}],
            'volumes': [{'id': 31, 'label': 'Application data', 'size': 200, 'region': 'us-east', 'status': 'active', 'filesystem_path': '/dev/disk/by-id/scsi-demo'}],
            'firewalls': [{'id': 41, 'label': 'Web access', 'status': 'enabled', 'rules': {'inbound_policy': 'DROP', 'outbound_policy': 'ACCEPT', 'inbound': [{'label': 'HTTPS', 'action': 'ACCEPT', 'protocol': 'TCP', 'ports': '443', 'addresses': {'ipv4': ['0.0.0.0/0']}}]}}],
        }.items()}}
    return None
