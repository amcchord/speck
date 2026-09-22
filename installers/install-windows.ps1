#Requires -RunAsAdministrator
param([string]$Server='https://speckrmm.com', [switch]$About)
$ErrorActionPreference='Stop'
Write-Host "`n  speck" -ForegroundColor Green
Write-Host '  A LITTLE LIGHTWEIGHT RMM'
Write-Host "`n  Windows agent installer`n"
if ($About) {
 Write-Host '  Installs or updates Speck Agent and its desktop helper.'
 Write-Host '  Use -Server for a self-hosted server.'
 Write-Host '  An enrollment token is requested only for a new device.'
 Write-Host "`n  https://speckrmm.com`n"
 return
}
if (-not $Server.StartsWith('https://')) {throw 'An HTTPS server is required'}
$Root='C:\ProgramData\Speck'
$Bin='C:\Program Files\Speck'
New-Item -ItemType Directory -Force $Root,$Bin | Out-Null
# Configuration and job history are readable only by SYSTEM and Administrators.
icacls $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
$Binary="$Bin\speck-agent.exe"
$Temp=Join-Path $env:TEMP ('speck-'+[Guid]::NewGuid().ToString()+'.exe')
try {
 Write-Host "  [1/3] Download and verify"
 Invoke-WebRequest "$Server/downloads/speck-agent-windows-amd64.exe" -OutFile $Temp -UseBasicParsing
 $Manifest=(Invoke-WebRequest "$Server/downloads/SHA256SUMS" -UseBasicParsing).Content
 if ($Manifest -is [byte[]]) {$Manifest=[Text.Encoding]::UTF8.GetString($Manifest)}
 $Line=($Manifest -split "`n" | ForEach-Object {$_.Trim()} | Where-Object {$_ -match '  speck-agent-windows-amd64.exe$'})
 if (-not $Line) {throw 'Agent checksum is missing from the manifest'}
 $Expected=$Line.Split(' ')[0]
 if (-not $Expected -or (Get-FileHash $Temp -Algorithm SHA256).Hash -ne $Expected) {throw 'Agent checksum mismatch'}
 Write-Host "`n  [2/3] Install and enroll"
 $Old=Get-Service SpeckAgent -ErrorAction SilentlyContinue
 if ($Old) {Stop-Service SpeckAgent -Force}
 Get-Process speck-agent,speck-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
 Move-Item $Temp $Binary -Force
 $Desktop="$Bin\speck-desktop.exe"
 Invoke-WebRequest "$Server/downloads/speck-desktop-windows-amd64.exe" -OutFile $Temp -UseBasicParsing
 $DesktopLine=($Manifest -split "`n" | ForEach-Object {$_.Trim()} | Where-Object {$_ -match '  speck-desktop-windows-amd64.exe$'})
 if (-not $DesktopLine -or (Get-FileHash $Temp -Algorithm SHA256).Hash -ne $DesktopLine.Split(' ')[0]) {throw 'Desktop helper checksum mismatch'}
 Move-Item $Temp $Desktop -Force
 if (-not (Test-Path "$Root\agent.json")) {
   if ($env:SPECK_ENROLLMENT_TOKEN) {$Token=$env:SPECK_ENROLLMENT_TOKEN;Remove-Item Env:\SPECK_ENROLLMENT_TOKEN}
   else {$Secure=Read-Host 'Single-use enrollment token' -AsSecureString; $Token=[Net.NetworkCredential]::new('',$Secure).Password}
   @{server=$Server;token=$Token} | ConvertTo-Json -Compress | & $Binary enroll
   $Token=$null
   if ($LASTEXITCODE -ne 0) {throw 'Enrollment failed'}
 }
 if (-not $Old) {& $Binary install; if ($LASTEXITCODE -ne 0) {throw 'Service installation failed'}}
 & sc.exe config SpeckAgent DisplayName= 'Speck Agent' | Out-Null
 if ($LASTEXITCODE -ne 0) {throw 'Service display name configuration failed'}
 & sc.exe description SpeckAgent 'A LITTLE LIGHTWEIGHT RMM. Windows and Linux monitoring, remote access and recovery.' | Out-Null
 if ($LASTEXITCODE -ne 0) {throw 'Service description configuration failed'}
 # Also repair recovery/start settings when upgrading an existing service.
 & sc.exe config SpeckAgent start= delayed-auto | Out-Null
 if ($LASTEXITCODE -ne 0) {throw 'Service start configuration failed'}
 & sc.exe failure SpeckAgent reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
 if ($LASTEXITCODE -ne 0) {throw 'Service recovery configuration failed'}
 New-Item -ItemType Directory -Force "$Root\telemetry" | Out-Null
 # Users can traverse the parent and write their own session telemetry, never credentials.
 icacls $Root /grant '*S-1-5-32-545:(RX)' | Out-Null
 icacls "$Root\telemetry" /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null
 New-Item -ItemType Directory -Force "$Root\public" | Out-Null
 icacls "$Root\public" /grant '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
 $Action=New-ScheduledTaskAction -Execute $Desktop
 $Trigger=New-ScheduledTaskTrigger -AtLogOn
 $Principal=New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
 $Settings=New-ScheduledTaskSettingsSet -MultipleInstances Parallel -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
 Register-ScheduledTask -Description 'Speck Desktop Helper. A little lightweight RMM.' -TaskName 'Speck Foreground' -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
 Write-Host "`n  [3/3] Start Speck Agent"
 Start-Service SpeckAgent
 # Restart the observer for existing interactive users after an upgrade. The
 # logon trigger remains for future sessions; no password or elevated token is used.
 $Users=@{}
 Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | ForEach-Object {
   $Owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwner
   if ($Owner.ReturnValue -eq 0) {$Users[($Owner.Domain+'\'+$Owner.User)]=$_.SessionId}
 }
 foreach ($User in $Users.Keys) {
   $Task='Speck Foreground Start-'+$Users[$User]
   try {
     $Interactive=New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
     Register-ScheduledTask -TaskName $Task -Action $Action -Principal $Interactive -Settings $Settings -Force | Out-Null
     Start-ScheduledTask -TaskName $Task
     # Let Task Scheduler launch the process before removing its one-shot entry.
     for ($Attempt=0; $Attempt -lt 10; $Attempt++) {
       if ((Get-ScheduledTask -TaskName $Task).State -eq 'Running') {break}
       Start-Sleep -Milliseconds 500
     }
   } catch {Write-Warning 'Desktop helper will start at the next sign-in.'}
   finally {Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue}
 }
 Write-Host "`n  Ready. Speck Agent is running." -ForegroundColor Green
 Write-Host "  Previews: available on signed-in, unlocked desktops.`n"
} finally {Remove-Item $Temp -ErrorAction SilentlyContinue}
