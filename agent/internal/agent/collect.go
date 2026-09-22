package agent

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
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
	result["active_app"] = latestForeground(foregroundDir)
	result["capabilities"] = map[string]any{"commands": true, "files": true, "powershell": hasPowerShell(), "active_app": result["active_app"] != nil, "desktop_note": "Browser desktop requires a local RDP/VNC service; headless Linux supports shell commands and files"}
	return result
}
func latestForeground(dir string) any {
	files, _ := os.ReadDir(dir)
	sort.Slice(files, func(i, j int) bool {
		a, _ := files[i].Info()
		b, _ := files[j].Info()
		return a != nil && b != nil && a.ModTime().After(b.ModTime())
	})
	for _, f := range files {
		if f.Type()&os.ModeSymlink != 0 || filepath.Ext(f.Name()) != ".json" {
			continue
		}
		info, e := f.Info()
		if e != nil || info.Size() > 8192 || time.Since(info.ModTime()) > 45*time.Second {
			continue
		}
		data, e := os.ReadFile(filepath.Join(dir, f.Name()))
		if e != nil {
			continue
		}
		var result map[string]any
		if json.Unmarshal(data, &result) == nil {
			return result
		}
	}
	return nil
}
func WriteForeground(dir string) {
	value := foreground()
	if value == nil {
		return
	}
	value["observed_at"] = time.Now().UTC().Format(time.RFC3339)
	// Installers create a separate writable telemetry directory; it contains no credentials.
	data, e := json.Marshal(value)
	if e != nil {
		return
	}
	name := filepath.Join(dir, foregroundFilename())
	_ = os.WriteFile(name, data, 0644)
}
