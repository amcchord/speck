"""Synthetic local UX fixtures; no production/customer data."""

def reliability_fixture(route, devices, now):
    if route == '/api/infrastructure/connections':
        return [{'id':'slide-settings','provider':'slide','name':'Slide (Settings)'}]
    if route == '/api/workspaces':
        return [{'id':'example-workspace','name':'Example customer','owner_id':'demo','revision':1,'updated':now,'members':[], 'retest_days':30,'associations':[{'kind':'machine','id':devices[0]['id'],'pinned':True}]}]
    if route == '/api/workspaces/catalog':
        return {'items':[{'kind':'machine','id':d['id'],'label':d['label']} for d in devices], 'connections':[], 'sources':[]}
    if route in ('/api/maintenance/runbooks','/api/maintenance/runs'):
        return []
    if route == '/api/ux/scorecard':
        return {'window_days':7,'client':'Hosted web console','rows':[{'journey':'first_content','surface':'fleet','bucket':200,'count':12,'outcome':'ready'}], 'note':'Synthetic local observations; no private content is recorded.'}
    return None
