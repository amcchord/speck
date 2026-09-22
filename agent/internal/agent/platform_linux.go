//go:build linux

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/shirou/gopsutil/v4/host"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func quiet(cmd *exec.Cmd)                          { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func replaceFile(source, destination string) error { return os.Rename(source, destination) }
func moveNewFile(source, destination string) error {
	if err := os.Link(source, destination); err != nil {
		return err
	}
	return os.Remove(source)
}
func hardwareID() string {
	for _, path := range []string{"/sys/class/dmi/id/product_uuid", "/etc/machine-id"} {
		if data, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(data))) > 5 {
			return sum([]byte("linux:" + strings.TrimSpace(string(data))))
		}
	}
	return ""
}
func services(ctx context.Context) any {
	out, _, err := command(ctx, "systemctl", "list-units", "--type=service", "--all", "--output=json", "--no-pager")
	if err != nil {
		return []any{map[string]any{"name": "systemd", "status": "unavailable"}}
	}
	var units []map[string]any
	if json.Unmarshal([]byte(out), &units) != nil {
		return []any{}
	}
	rows := []any{}
	for _, u := range units {
		rows = append(rows, map[string]any{"name": u["unit"], "display_name": u["description"], "status": u["active"], "detail": u["sub"]})
	}
	return rows
}
func controlService(ctx context.Context, name, action string) (map[string]any, error) {
	if !safeName.MatchString(name) || strings.HasPrefix(name, "-") {
		return nil, errors.New("invalid service name")
	}
	if action != "start" && action != "stop" && action != "restart" {
		return nil, errors.New("invalid service action")
	}
	out, code, err := command(ctx, "systemctl", action, name)
	return map[string]any{"output": out, "exit_code": code, "name": name, "action": action}, err
}
func networkDetails(ctx context.Context) map[string]any {
	result := map[string]any{}
	out, _, err := command(ctx, "ip", "-j", "route", "show", "table", "all")
	if err == nil {
		var routes any
		if json.Unmarshal([]byte(out), &routes) == nil {
			result["routes"] = routes
		}
	}
	data, _ := os.ReadFile("/etc/resolv.conf")
	dns := []string{}
	for _, line := range strings.Split(string(data), "\n") {
		v := strings.Fields(line)
		if len(v) > 1 && v[0] == "nameserver" {
			dns = append(dns, v[1])
		}
	}
	result["dns_servers"] = dns
	if out, _, err := command(ctx, "resolvectl", "dns"); err == nil {
		result["resolver_details"] = out
	}
	return result
}
func foreground() map[string]any {
	if os.Getenv("DISPLAY") == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, _, err := command(ctx, "xprop", "-root", "_NET_ACTIVE_WINDOW")
	if err != nil {
		return nil
	}
	parts := strings.Fields(out)
	if len(parts) < 1 {
		return nil
	}
	window := parts[len(parts)-1]
	if window == "0x0" {
		return nil
	}
	title, _, _ := command(ctx, "xprop", "-id", window, "_NET_WM_NAME", "WM_NAME", "_NET_WM_PID")
	return map[string]any{"title": strings.TrimSpace(title), "user": os.Getenv("USER"), "session": os.Getenv("XDG_SESSION_ID"), "display": os.Getenv("DISPLAY"), "source": "X11"}
}
func foregroundFilename() string { return fmt.Sprintf("session-%s.json", strconv.Itoa(os.Getuid())) }

func previewDesktopState() string {
	if os.Getenv("XDG_SESSION_TYPE") == "wayland" {
		return "unsupported"
	}
	if os.Getenv("DISPLAY") == "" || foreground() == nil {
		return "no_desktop"
	}
	return ""
}

func loggedInSessions() ([]DesktopSession, error) {
	result := []DesktopSession{}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// Modern systemd installations may omit utmp entirely. Ask logind first;
	// retain utmp as a fallback on other supported Linux distributions.
	if out, code, err := command(ctx, "loginctl", "list-sessions", "--no-legend", "--no-pager"); err == nil && code == 0 {
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 3 {
				result = append(result, DesktopSession{User: fields[2], Session: fields[0], State: "signed_in"})
			}
		}
		return result, nil
	}
	users, err := host.UsersWithContext(ctx)
	for _, u := range users {
		result = append(result, DesktopSession{User: u.User, Session: u.Terminal, State: "signed_in"})
	}
	return result, err
}
