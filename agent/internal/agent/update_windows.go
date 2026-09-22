//go:build windows

package agent

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

func protectUpdateDir(path string) error {
	cmd := exec.Command("icacls.exe", path, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F")
	quiet(cmd)
	return cmd.Run()
}
func launchUpdate(helper, config string) error {
	cmd := exec.Command(helper, "--config", config, "apply-update")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000008 | 0x00000200}
	if e := cmd.Start(); e != nil {
		return e
	}
	return cmd.Process.Release()
}
func controlUpdateService(parent context.Context, action string) error {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	manager, e := mgr.Connect()
	if e != nil {
		return e
	}
	defer manager.Disconnect()
	service, e := manager.OpenService("SpeckAgent")
	if e != nil {
		return e
	}
	defer service.Close()
	state, e := service.Query()
	if e != nil {
		return e
	}
	target := svc.Stopped
	if action == "stop" {
		if state.State != svc.Stopped {
			_, e = service.Control(svc.Stop)
		}
	} else {
		target = svc.Running
		if state.State != svc.Running {
			e = service.Start()
		}
	}
	if e != nil {
		return e
	}
	for {
		state, e = service.Query()
		if e != nil {
			return e
		}
		if state.State == target {
			return nil
		}
		select {
		case <-ctx.Done():
			return errors.New("service update transition timed out")
		case <-time.After(250 * time.Millisecond):
		}
	}
}
func stopUpdateHelpers(install string) error {
	// Scope process termination to the installed Speck helper, not an arbitrary name.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter "Name='speck-desktop.exe'" | Where-Object {$_.ExecutablePath -eq (Join-Path $env:SPECK_UPDATE_INSTALL 'speck-desktop.exe')} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force}`)
	cmd.Env = append(cmd.Environ(), "SPECK_UPDATE_INSTALL="+install)
	quiet(cmd)
	return cmd.Run()
}
func refreshUpdateHelpers(install string) {
	// Reuse the existing unprivileged logon task; never request a user's password.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `
$Action=New-ScheduledTaskAction -Execute (Join-Path $env:SPECK_UPDATE_INSTALL 'speck-desktop.exe')
$Settings=New-ScheduledTaskSettingsSet -MultipleInstances Parallel -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$Users=@{}
Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | ForEach-Object {
 $Owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwner
 if ($Owner.ReturnValue -eq 0) {$Users[($Owner.Domain+'\'+$Owner.User)]=$_.SessionId}
}
foreach ($User in $Users.Keys) {
 $Task='Speck Foreground Update-'+$Users[$User]
 try {
  $Principal=New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $Task -Action $Action -Principal $Principal -Settings $Settings -Force | Out-Null
  Start-ScheduledTask -TaskName $Task
  Start-Sleep -Milliseconds 500
 } finally {Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue}
}`)
	cmd.Env = append(cmd.Environ(), "SPECK_UPDATE_INSTALL="+install)
	quiet(cmd)
	_ = cmd.Run()
}

func finalizeUpdateFiles(install string) error {
	for _, name := range []string{"speck-agent.exe", "speck-desktop.exe"} {
		cmd := exec.Command("icacls.exe", filepath.Join(install, name), "/reset")
		quiet(cmd)
		if err := cmd.Run(); err != nil {
			return err
		}
	}
	return nil
}
