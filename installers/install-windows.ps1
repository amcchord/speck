#Requires -RunAsAdministrator
param([string]$Server='https://speckrmm.com')
$ErrorActionPreference='Stop'
if (-not $Server.StartsWith('https://')) {throw 'An HTTPS server is required'}
$Root='C:\ProgramData\Speck'
$Bin='C:\Program Files\Speck'
New-Item -ItemType Directory -Force $Root,$Bin | Out-Null
# Configuration and job history are readable only by SYSTEM and Administrators.
icacls $Root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
$Binary="$Bin\speck-agent.exe"
$Temp=Join-Path $env:TEMP ('speck-'+[Guid]::NewGuid().ToString()+'.exe')
try {
 Invoke-WebRequest "$Server/downloads/speck-agent-windows-amd64.exe" -OutFile $Temp -UseBasicParsing
 $Manifest=(Invoke-WebRequest "$Server/downloads/SHA256SUMS" -UseBasicParsing).Content
 if ($Manifest -is [byte[]]) {$Manifest=[Text.Encoding]::UTF8.GetString($Manifest)}
 $Line=($Manifest -split "`n" | ForEach-Object {$_.Trim()} | Where-Object {$_ -match '  speck-agent-windows-amd64.exe$'})
 if (-not $Line) {throw 'Agent checksum is missing from the manifest'}
 $Expected=$Line.Split(' ')[0]
 if (-not $Expected -or (Get-FileHash $Temp -Algorithm SHA256).Hash -ne $Expected) {throw 'Agent checksum mismatch'}
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
 # Also repair recovery/start settings when upgrading an existing service.
 & sc.exe config SpeckAgent start= delayed-auto | Out-Null
 if ($LASTEXITCODE -ne 0) {throw 'Service start configuration failed'}
 & sc.exe failure SpeckAgent reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
 if ($LASTEXITCODE -ne 0) {throw 'Service recovery configuration failed'}
 New-Item -ItemType Directory -Force "$Root\telemetry" | Out-Null
 # Users can traverse the parent and write their own session telemetry, never credentials.
 icacls $Root /grant '*S-1-5-32-545:(RX)' | Out-Null
 icacls "$Root\telemetry" /grant '*S-1-5-32-545:(OI)(CI)M' | Out-Null
 $Action=New-ScheduledTaskAction -Execute $Desktop
 $Trigger=New-ScheduledTaskTrigger -AtLogOn
 $Principal=New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
 $Settings=New-ScheduledTaskSettingsSet -MultipleInstances Parallel -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
 Register-ScheduledTask -TaskName 'Speck Foreground' -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
 Start-Service SpeckAgent
 Write-Host 'Speck installed. Active-app reporting starts at the next interactive sign-in.'
} finally {Remove-Item $Temp -ErrorAction SilentlyContinue}
