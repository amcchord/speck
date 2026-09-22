# Run only on an identified restored instance, never on the source machine.
# Produces no output on success so application proof output stays comparable.
param(
 [Parameter(Mandatory=$true)][string]$Address,
 [Parameter(Mandatory=$true)][string]$Gateway,
 [Parameter(Mandatory=$true)][string]$HealthUrl,
 [string]$Mask='255.255.255.0',
 [string[]]$DnsServers=@('1.1.1.1','1.0.0.1')
)
$ErrorActionPreference='Stop'
$nic=Get-NetAdapter | Where-Object {$_.Status -eq 'Up' -and $_.HardwareInterface} | Select-Object -First 1
if (-not $nic) {throw 'No active hardware network adapter found'}
if (Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object IPAddress -eq $Address) {return}
# Restore DHCP automatically if the static configuration loses connectivity.
$task='Speck Recovery Network '+[Guid]::NewGuid().ToString('N')
$alias=$nic.Name.Replace("'","''")
$rollback=@"
`$ErrorActionPreference='Continue'
& netsh.exe interface ipv4 set address name='$alias' source=dhcp | Out-Null
Set-DnsClientServerAddress -InterfaceIndex $($nic.ifIndex) -ResetServerAddresses
Unregister-ScheduledTask -TaskName '$task' -Confirm:`$false
"@
$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($rollback))
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -EncodedCommand $encoded"
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(3)
$principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
# One netsh operation avoids an intermediate state with DHCP disabled and no IP.
& netsh.exe interface ipv4 set address name="$($nic.Name)" source=static address=$Address mask=$Mask gateway=$Gateway gwmetric=1 | Out-Null
if ($LASTEXITCODE -ne 0) {throw 'Static IP configuration failed; automatic DHCP recovery remains armed'}
Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ServerAddresses $DnsServers
Start-Sleep -Seconds 8
if (-not (Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object IPAddress -eq $Address)) {throw 'Expected static IP is missing; automatic DHCP recovery remains armed'}
$null=Invoke-WebRequest $HealthUrl -UseBasicParsing -TimeoutSec 20
Unregister-ScheduledTask -TaskName $task -Confirm:$false
