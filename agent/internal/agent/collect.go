package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
)

func Collect(foregroundDir string) map[string]any {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	result := map[string]any{"version": Version, "collected_at": time.Now().UTC().Format(time.RFC3339), "platform": runtime.GOOS}
	if h, e := host.InfoWithContext(ctx); e == nil {
		result["host"] = h
	}
	if m, e := mem.VirtualMemoryWithContext(ctx); e == nil {
		result["memory"] = m
	}
	if c, e := cpu.PercentWithContext(ctx, 0, false); e == nil && len(c) > 0 {
		result["cpu_percent"] = c[0]
	}
	partitions, _ := disk.PartitionsWithContext(ctx, false)
	disks := []any{}
	for _, p := range partitions {
		if d, e := disk.UsageWithContext(ctx, p.Mountpoint); e == nil {
			disks = append(disks, d)
		}
	}
	result["disks"] = disks
	interfaces, _ := gnet.InterfacesWithContext(ctx)
	ifaces := []any{}
	for _, i := range interfaces {
		addrs := []any{}
		for _, a := range i.Addrs {
			addrs = append(addrs, map[string]any{"address": a.Addr})
		}
		ifaces = append(ifaces, map[string]any{"name": i.Name, "index": i.Index, "mtu": i.MTU, "mac": i.HardwareAddr, "flags": i.Flags, "addrs": addrs})
	}
	counters, _ := gnet.IOCountersWithContext(ctx, true)
	connections, _ := gnet.ConnectionsWithContext(ctx, "inet")
	truncated := len(connections) > 350
	if truncated {
		connections = connections[:350]
	}
	sockets := []any{}
	names := map[int32]string{}
	for _, c := range connections {
		if _, ok := names[c.Pid]; !ok {
			p, e := process.NewProcess(c.Pid)
			if e == nil {
				names[c.Pid], _ = p.NameWithContext(ctx)
			}
		}
		sockets = append(sockets, map[string]any{"local": c.Laddr, "remote": c.Raddr, "status": c.Status, "pid": c.Pid, "process": names[c.Pid], "type": c.Type})
	}
	detail := networkDetails(ctx)
	detail["interfaces"] = ifaces
	detail["counters"] = counters
	detail["connections"] = sockets
	detail["connections_truncated"] = truncated
	result["network"] = detail
	result["services"] = services(ctx)
	updateDesktopTelemetry(result, foregroundDir)
	result["capabilities"] = map[string]any{"managed_operations": true, "screen_preview": true, "commands": true, "files": true, "powershell": hasPowerShell(), "active_app": result["active_app"] != nil, "desktop_note": "Browser desktop requires a local RDP/VNC service; headless Linux opens an interactive web shell through the agent"}
	for key, value := range remoteCapabilities() {
		result["capabilities"].(map[string]any)[key] = value
	}
	return result
}

type DesktopSession struct {
	User    string `json:"user"`
	Session string `json:"session"`
	State   string `json:"state"`
}

// Desktop observations are refreshed on every heartbeat, independently of the
// slower CPU/disk/service inventory. Logged-in sessions do not require a helper.
func updateDesktopTelemetry(result map[string]any, dir string) {
	sessions, err := loggedInSessions()
	current, last, helperActive := foregroundState(dir, time.Now(), sessions)
	state := "no_session"
	if err != nil {
		state = "unknown"
	}
	if len(sessions) > 0 {
		state = "disconnected"
	}
	for _, s := range sessions {
		if s.State == "active" {
			state = "unavailable"
		}
		if s.State == "signed_in" && state != "unavailable" {
			state = "no_desktop"
		}
	}
	if helperActive {
		state = "active"
	}
	result["active_app"] = current
	result["last_active_app"] = last
	result["logged_in_users"] = sessions
	result["desktop"] = map[string]any{"state": state, "observed_at": time.Now().UTC().Format(time.RFC3339), "sessions_available": err == nil}
}

func foregroundState(dir string, now time.Time, sessions []DesktopSession) (map[string]any, map[string]any, bool) {
	files, _ := os.ReadDir(dir)
	var current, last map[string]any
	var currentAt, lastAt time.Time
	helperActive := false
	// A usable desktop can exist without a foreground window/app.
	for _, f := range files {
		if f.Type()&os.ModeSymlink != 0 || !strings.HasPrefix(f.Name(), "session-") || filepath.Ext(f.Name()) != ".desktop-status" {
			continue
		}
		info, e := f.Info()
		if e != nil || !info.Mode().IsRegular() || info.Size() > 2048 {
			continue
		}
		data, e := os.ReadFile(filepath.Join(dir, f.Name()))
		var status PreviewStatus
		if e != nil || json.Unmarshal(data, &status) != nil || status.State != "active" || now.Unix()-status.ObservedAt > 30 || status.ObservedAt > now.Unix()+5 {
			continue
		}
		if runtime.GOOS == "windows" {
			connected := false
			for _, session := range sessions {
				if "session-"+session.Session+".desktop-status" == f.Name() && session.State == "active" {
					connected = true
				}
			}
			if !connected {
				continue
			}
		}
		helperActive = true
	}
	for _, f := range files {
		if f.Type()&os.ModeSymlink != 0 || !strings.HasPrefix(f.Name(), "session-") || filepath.Ext(f.Name()) != ".json" {
			continue
		}
		info, e := f.Info()
		if e != nil || !info.Mode().IsRegular() || info.Size() > 8192 {
			continue
		}
		data, e := os.ReadFile(filepath.Join(dir, f.Name()))
		var value map[string]any
		if e != nil || json.Unmarshal(data, &value) != nil {
			continue
		}
		observed, e := time.Parse(time.RFC3339, fmt.Sprint(value["observed_at"]))
		if e != nil || observed.After(now.Add(5*time.Second)) {
			continue
		}
		if observed.After(lastAt) {
			last, lastAt = value, observed
		}
		stateFile := filepath.Join(dir, strings.TrimSuffix(f.Name(), ".json")+".desktop-status")
		statusInfo, e := os.Lstat(stateFile)
		if e != nil || !statusInfo.Mode().IsRegular() || statusInfo.Size() > 2048 {
			continue
		}
		raw, e := os.ReadFile(stateFile)
		var status PreviewStatus
		if e != nil || json.Unmarshal(raw, &status) != nil || status.State != "active" || now.Unix()-status.ObservedAt > 30 || status.ObservedAt > now.Unix()+5 {
			continue
		}
		if runtime.GOOS == "windows" {
			connected := false
			for _, session := range sessions {
				if session.Session == fmt.Sprint(value["session"]) && session.State == "active" && strings.EqualFold(session.User, fmt.Sprint(value["user"])) {
					connected = true
				}
			}
			if !connected {
				continue
			}
		}
		helperActive = true
		if now.Sub(observed) <= 30*time.Second && observed.After(currentAt) {
			current, currentAt = value, observed
		}
	}
	return current, last, helperActive
}

func WriteForeground(dir string) {
	state := previewDesktopState()
	if state == "" {
		state = "active"
	}
	// A locked/disconnected session retains its last app, but never labels it current.
	name := filepath.Join(dir, foregroundFilename())
	_ = writeJSON(strings.TrimSuffix(name, ".json")+".desktop-status", PreviewStatus{state, time.Now().Unix()}, 0644)
	if state != "active" {
		return
	}
	value := foreground()
	if value == nil {
		return
	}
	value["observed_at"] = time.Now().UTC().Format(time.RFC3339)
	// Atomic replacement prevents service reads from seeing a truncated JSON file.
	_ = writeJSON(name, value, 0644)
}
