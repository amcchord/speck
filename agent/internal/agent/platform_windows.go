//go:build windows

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/shirou/gopsutil/v4/process"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

func quiet(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }
func replaceFile(source, destination string) error {
	a, e := windows.UTF16PtrFromString(source)
	if e != nil {
		return e
	}
	b, e := windows.UTF16PtrFromString(destination)
	if e != nil {
		return e
	}
	return windows.MoveFileEx(a, b, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
func moveNewFile(source, destination string) error {
	a, e := windows.UTF16PtrFromString(source)
	if e != nil {
		return e
	}
	b, e := windows.UTF16PtrFromString(destination)
	if e != nil {
		return e
	}
	return windows.MoveFileEx(a, b, windows.MOVEFILE_WRITE_THROUGH)
}
func hardwareID() string {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	out, _, err := command(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID")
	if err != nil {
		return ""
	}
	return sum([]byte("windows:" + strings.TrimSpace(out)))
}
func services(ctx context.Context) any {
	manager, err := mgr.Connect()
	if err != nil {
		return []any{}
	}
	defer manager.Disconnect()
	names, _ := manager.ListServices()
	sort.Strings(names)
	rows := []any{}
	states := map[svc.State]string{svc.Running: "running", svc.Stopped: "stopped", svc.StartPending: "starting", svc.StopPending: "stopping", svc.Paused: "paused"}
	for _, name := range names {
		if ctx.Err() != nil {
			break
		}
		s, err := manager.OpenService(name)
		if err != nil {
			continue
		}
		status, e := s.Query()
		cfg, _ := s.Config()
		s.Close()
		if e == nil {
			rows = append(rows, map[string]any{"name": name, "display_name": cfg.DisplayName, "status": states[status.State], "start_type": cfg.StartType})
		}
	}
	return rows
}
func controlService(ctx context.Context, name, action string) (map[string]any, error) {
	if !safeName.MatchString(name) {
		return nil, errors.New("invalid service name")
	}
	if action != "start" && action != "stop" && action != "restart" {
		return nil, errors.New("invalid service action")
	}
	manager, err := mgr.Connect()
	if err != nil {
		return nil, err
	}
	defer manager.Disconnect()
	s, err := manager.OpenService(name)
	if err != nil {
		return nil, err
	}
	defer s.Close()
	if action == "stop" || action == "restart" {
		state, e := s.Query()
		if e != nil {
			return nil, e
		}
		if state.State != svc.Stopped {
			if _, err = s.Control(svc.Stop); err != nil {
				return nil, err
			}
			for {
				state, err = s.Query()
				if err != nil {
					return nil, err
				}
				if state.State == svc.Stopped {
					break
				}
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(500 * time.Millisecond):
				}
			}
		}
	}
	if action == "start" || action == "restart" {
		if err = s.Start(); err != nil {
			return nil, err
		}
	}
	return map[string]any{"name": name, "action": action}, nil
}
func networkDetails(ctx context.Context) map[string]any {
	script := `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); @{routes=@(Get-NetRoute | Select-Object DestinationPrefix,NextHop,InterfaceAlias,RouteMetric,AddressFamily);dns_servers=@(Get-DnsClientServerAddress | Where-Object {$_.ServerAddresses.Count -gt 0} | Select-Object InterfaceAlias,AddressFamily,ServerAddresses)} | ConvertTo-Json -Depth 5 -Compress`
	out, _, err := command(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	result := map[string]any{}
	if err == nil {
		_ = json.Unmarshal([]byte(strings.TrimSpace(out)), &result)
	}
	return result
}

var user32 = windows.NewLazySystemDLL("user32.dll")
var getForeground = user32.NewProc("GetForegroundWindow")
var getText = user32.NewProc("GetWindowTextW")
var getPID = user32.NewProc("GetWindowThreadProcessId")

func foreground() map[string]any {
	handle, _, _ := getForeground.Call()
	if handle == 0 {
		return nil
	}
	buffer := make([]uint16, 1024)
	count, _, _ := getText.Call(handle, uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
	var pid uint32
	getPID.Call(handle, uintptr(unsafe.Pointer(&pid)))
	name := ""
	if p, e := process.NewProcess(int32(pid)); e == nil {
		name, _ = p.Name()
	}
	var session uint32
	_ = windows.ProcessIdToSessionId(uint32(os.Getpid()), &session)
	return map[string]any{"title": windows.UTF16ToString(buffer[:int(count)]), "pid": pid, "process": name, "user": os.Getenv("USERDOMAIN") + `\` + os.Getenv("USERNAME"), "session": session, "source": "Windows foreground window"}
}
func foregroundFilename() string {
	var session uint32
	_ = windows.ProcessIdToSessionId(uint32(os.Getpid()), &session)
	return fmt.Sprintf("session-%d.json", session)
}
