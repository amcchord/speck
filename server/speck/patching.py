"""Native update scripts. No reboot, driver installation or package removal."""

import json
import re
import shlex

from fastapi import HTTPException

WINDOWS_SCAN = r"""
$session=New-Object -ComObject Microsoft.Update.Session
$search=$session.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
$items=@($search.Updates | Select-Object -First 150 | ForEach-Object {
 @{id=$_.Identity.UpdateID;title=$_.Title;version=[string]$_.Identity.RevisionNumber;severity=[string]$_.MsrcSeverity;kb=@($_.KBArticleIDs);reboot=$_.RebootRequired}
})
$system=New-Object -ComObject Microsoft.Update.SystemInfo
@{manager='windows-update';updates=$items;total=$search.Updates.Count;truncated=($search.Updates.Count -gt 150);reboot_required=$system.RebootRequired} | ConvertTo-Json -Depth 6 -Compress
"""
LINUX_SCAN = r"""
set -eu
command -v python3 >/dev/null || { echo 'Patch inventory requires python3' >&2; exit 1; }
python3 - <<'SPECKPY'
import json,os,shutil,subprocess
updates=[]
if shutil.which('apt-get'):
 subprocess.run(['apt-get','update','-qq'],check=True,stdout=subprocess.DEVNULL)
 result=subprocess.run(['apt','list','--upgradable'],capture_output=True,text=True,check=True)
 for line in result.stdout.splitlines():
  if '/' not in line or line.startswith('Listing'):continue
  fields=line.split()
  updates.append({'id':fields[0].split('/')[0],'title':fields[0].split('/')[0],'version':fields[1],'severity':'security' if 'security' in fields[0] else 'update','kb':[],'reboot':False})
 manager='apt'
elif shutil.which('dnf'):
 result=subprocess.run(['dnf','-q','check-update','--refresh'],capture_output=True,text=True)
 if result.returncode not in (0,100):raise RuntimeError('DNF scan failed: '+result.stderr[-500:])
 for line in result.stdout.splitlines():
  f=line.split()
  if len(f)==3 and '.' in f[0]:updates.append({'id':f[0],'title':f[0],'version':f[1],'severity':'update','kb':[],'reboot':False})
 manager='dnf'
else:raise RuntimeError('This distribution needs apt or dnf')
print(json.dumps({'manager':manager,'updates':updates[:150],'total':len(updates),'truncated':len(updates)>150,'reboot_required':os.path.exists('/var/run/reboot-required')}))
SPECKPY
"""


def install_script(platform, ids, manager):
    if not ids or len(ids) > 150 or len(set(ids)) != len(ids):
        raise HTTPException(422, "Select 1–150 distinct updates")
    if platform == "windows":
        if any(not re.fullmatch(r"[0-9a-fA-F-]{36}", i) for i in ids):
            raise HTTPException(422, "Invalid Windows update identity")
        wanted = json.dumps(ids, separators=(",", ":")).replace("'", "''")
        return r"""
$wanted=@(ConvertFrom-Json 'WANTED')
$session=New-Object -ComObject Microsoft.Update.Session
$search=$session.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
$chosen=New-Object -ComObject Microsoft.Update.UpdateColl
foreach($update in $search.Updates) {
 if($wanted -contains $update.Identity.UpdateID) {
  if(-not $update.EulaAccepted){$update.AcceptEula()}
  [void]$chosen.Add($update)
 }
}
if($chosen.Count -ne $wanted.Count){throw 'Update inventory changed. Scan again before installation.'}
$download=$session.CreateUpdateDownloader();$download.Updates=$chosen
$result=$download.Download()
if($result.ResultCode -ne 2){throw 'Some updates could not be downloaded'}
$installer=$session.CreateUpdateInstaller();$installer.Updates=$chosen
$installer.AllowSourcePrompts=$false
$result=$installer.Install()
$items=@(for($i=0;$i -lt $chosen.Count;$i++){@{id=$chosen.Item($i).Identity.UpdateID;title=$chosen.Item($i).Title;result=$result.GetUpdateResult($i).ResultCode}})
@{result=$result.ResultCode;reboot_required=$result.RebootRequired;updates=$items} | ConvertTo-Json -Depth 5 -Compress
if($result.ResultCode -ne 2){throw 'One or more updates failed; inspect individual results'}
""".replace("WANTED", wanted)
    if manager not in ("apt", "dnf") or any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9+_.:-]{0,180}", i) for i in ids):
        raise HTTPException(422, "Invalid Linux package selection")
    packages = " ".join(shlex.quote(i) for i in ids)
    command = (
        f"apt-get install -y --only-upgrade --no-remove -- {packages}"
        if manager == "apt"
        else f"dnf upgrade -y -- {packages}"
    )
    return (
        "set -eu\nexport DEBIAN_FRONTEND=noninteractive\n"
        + command
        + '\nif [ -f /var/run/reboot-required ]; then echo "Reboot required; no reboot was performed."; fi\n'
    )
