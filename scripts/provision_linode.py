"""Create only Speck's own Linode and parked DNS record; keep secrets in AustinLand."""
import json
import secrets
import urllib.request
from pathlib import Path

BASE='http://127.0.0.1:8472'
def api(path, data=None):
    req=urllib.request.Request(BASE+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=180) as response:return json.load(response)

def main():
    rows=api('/api/linode/instances')
    if isinstance(rows,dict):rows=rows['data']
    existing=[r for r in rows if r['label']=='speck-rmm']
    if existing:
        vm=existing[0]
    else:
        keys=api('/api/ssh/keys')
        if isinstance(keys,dict):keys=keys['keys']
        key=next(k['public_key'] for k in keys if k.get('name') == 'id_ed25519')
        credentials={'LINODE_ROOT_PASSWORD':secrets.token_urlsafe(40),'ADMIN_USERNAME':'austin',
                     'ADMIN_PASSWORD':secrets.token_urlsafe(30),'SESSION_SECRET':secrets.token_urlsafe(48),
                     'ENCRYPTION_KEY':secrets.token_urlsafe(32)}
        # Abort if this entry already exists rather than replace credentials.
        names=api('/api/keys')
        if isinstance(names,dict):names=names.get('entries',names.get('keys',[]))
        if any(x.get('name')=='speck-rmm' for x in names):raise RuntimeError('Speck credentials exist without a matching Linode; inspect before retrying')
        api('/api/keys/static',{'name':'speck-rmm','secrets':credentials})
        vm=api('/api/linode/instances',{'label':'speck-rmm','type':'g6-standard-2','region':'us-east',
             'image':'linode/debian13','root_pass':credentials['LINODE_ROOT_PASSWORD'],'authorized_keys':[key]})
    ip=vm['ipv4'][0]
    records=api('/api/dns/domains/speckrmm.com/records')
    current=[r['data'] for r in records if r['type']=='A' and r['name']=='@']
    if any(x not in ('Parked',ip) for x in current):raise RuntimeError('Domain points at an existing workload; no DNS change made')
    api('/api/dns/domains/speckrmm.com/point',{'name':'@','ip':ip})
    out=Path('output/deployment.json');out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({k:vm.get(k) for k in ['id','label','ipv4','region','type']},indent=2)+'\n')
    print(json.dumps({'id':vm['id'],'label':vm['label'],'ip':ip,'domain':'speckrmm.com'}))

if __name__=='__main__':main()
