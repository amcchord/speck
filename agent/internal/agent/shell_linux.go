//go:build linux

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"golang.org/x/sys/unix"
)

// logind records both X11 and Wayland sessions, including locked desktops and
// greeters. An agent service's own DISPLAY/active window is not a desktop probe.
func displayState(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "unknown"
	}
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return "unknown"
		}
		for _, line := range strings.Split(string(data), "\n") {
			if line == "TYPE=x11" || line == "TYPE=wayland" || strings.HasPrefix(line, "DISPLAY=:") {
				return "available"
			}
		}
	}
	// Also cover X servers launched without logind (including xrdp).
	sockets, _ := filepath.Glob("/tmp/.X11-unix/X*")
	if len(sockets) > 0 {
		return "available"
	}
	return "headless"
}

func remoteCapabilities() map[string]any {
	return map[string]any{"web_shell": true, "desktop": displayState("/run/systemd/sessions")}
}

func shellSize(cols, rows int) *pty.Winsize {
	return &pty.Winsize{Cols: uint16(max(2, min(500, cols))), Rows: uint16(max(1, min(200, rows)))}
}

func startShell(cols, rows int) (*exec.Cmd, *os.File, error) {
	shell := "/bin/bash"
	if _, err := os.Stat(shell); err != nil {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell, "-l")
	// Never pass the agent's service environment (which may contain credentials)
	// into a shell. Login startup files are the endpoint administrator's own code.
	home, _ := os.UserHomeDir()
	if home == "" {
		home = "/"
	}
	cmd.Dir = home
	cmd.Env = []string{"HOME=" + home, "SHELL=" + shell, "TERM=xterm-256color", "COLORTERM=truecolor", "LANG=C.UTF-8", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
	terminal, err := pty.StartWithSize(cmd, shellSize(cols, rows))
	if err != nil {
		return cmd, nil, err
	}
	// os.NewFile must see O_NONBLOCK when it registers the descriptor with Go's
	// poller, so closing it can interrupt a read even while a foreground job runs.
	fd, err := unix.Dup(int(terminal.Fd()))
	if err == nil {
		unix.CloseOnExec(fd)
		err = unix.SetNonblock(fd, true)
	}
	if err != nil {
		if fd >= 0 {
			_ = unix.Close(fd)
		}
		_ = terminal.Close()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return cmd, nil, err
	}
	pollable := os.NewFile(uintptr(fd), "shell-pty")
	_ = terminal.Close()
	return cmd, pollable, nil
}

func (c *Client) shell(ctx context.Context, p map[string]any) (map[string]any, error) {
	address := "wss" + strings.TrimPrefix(c.Config.Server, "https") + "/api/agent/tunnels/" + url.PathEscape(text(p, "session_id"))
	header := http.Header{"Authorization": {"Bearer " + c.Config.Token}, "X-Speck-Hardware": {c.Hardware}, "X-Speck-Tunnel-Secret": {text(p, "secret")}}
	ws, _, err := websocket.DefaultDialer.DialContext(ctx, address, header)
	if err != nil {
		return nil, errors.New("web shell connection failed")
	}
	defer ws.Close()
	ws.SetReadLimit(65536)
	cmd, terminal, err := startShell(number(p, "cols", 100), number(p, "rows", 30))
	if err != nil {
		return nil, errors.New("could not start an interactive shell")
	}
	// Closing the controlling terminal hangs up foreground jobs. Kill the shell's
	// process group as well, and reap it before the job is marked complete.
	defer func() {
		_ = terminal.Close()
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		_ = cmd.Wait()
	}()
	if err = ws.WriteJSON(map[string]any{"type": "ready"}); err != nil {
		return nil, err
	}
	var workers sync.WaitGroup
	workers.Add(2)
	defer func() { _ = ws.Close(); _ = terminal.Close(); workers.Wait() }()
	errs := make(chan error, 2)
	go func() {
		defer workers.Done()
		buffer := make([]byte, 16384)
		for {
			n, err := terminal.Read(buffer)
			if n > 0 {
				if e := ws.WriteMessage(websocket.BinaryMessage, buffer[:n]); e != nil {
					errs <- e
					return
				}
			}
			if err != nil {
				errs <- err
				return
			}
		}
	}()
	go func() {
		defer workers.Done()
		for {
			kind, value, err := ws.ReadMessage()
			if err != nil {
				errs <- err
				return
			}
			if kind != websocket.TextMessage {
				errs <- errors.New("invalid shell input")
				return
			}
			var input struct {
				Type string `json:"type"`
				Data string `json:"data"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if err = json.Unmarshal(value, &input); err != nil {
				errs <- err
				return
			}
			switch input.Type {
			case "input":
				_, err = terminal.Write([]byte(input.Data))
			case "resize":
				var control syscall.RawConn
				control, err = terminal.SyscallConn()
				if err == nil {
					var resizeErr error
					size := shellSize(input.Cols, input.Rows)
					err = control.Control(func(fd uintptr) {
						resizeErr = unix.IoctlSetWinsize(int(fd), unix.TIOCSWINSZ, &unix.Winsize{Col: size.Cols, Row: size.Rows})
					})
					if err == nil {
						err = resizeErr
					}
				}
			default:
				err = errors.New("invalid shell input")
			}
			if err != nil {
				errs <- err
				return
			}
		}
	}()
	select {
	case <-ctx.Done():
	case <-errs:
	}
	return map[string]any{"session": "ended"}, nil
}
