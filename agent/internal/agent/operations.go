package agent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type cappedBuffer struct {
	mu        sync.Mutex
	data      []byte
	truncated bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	space := 65536 - len(b.data)
	if len(p) > space {
		p = p[:space]
		b.truncated = true
	}
	b.data = append(b.data, p...)
	return n, nil
}
func command(ctx context.Context, name string, args ...string) (string, int, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	quiet(cmd)
	var buf cappedBuffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	cmd.WaitDelay = 3 * time.Second
	err := cmd.Run()
	code := 0
	if err != nil {
		code = -1
		if e, ok := err.(*exec.ExitError); ok {
			code = e.ExitCode()
		}
	}
	out := string(buf.data)
	if buf.truncated {
		out += "\n[output truncated at 64 KiB]"
	}
	return out, code, err
}
func runScript(ctx context.Context, shell, script string) (map[string]any, error) {
	if script == "" || len(script) > 65536 {
		return nil, errors.New("invalid script")
	}
	var cmd *exec.Cmd
	if shell == "powershell" || runtime.GOOS == "windows" {
		binary := "powershell.exe"
		if runtime.GOOS != "windows" {
			binary = "pwsh"
		}
		file, err := os.CreateTemp("", "speck-job-*.ps1")
		if err != nil {
			return nil, err
		}
		defer os.Remove(file.Name())
		_ = file.Chmod(0600)
		_, err = file.WriteString("$ErrorActionPreference='Stop'\n$global:LASTEXITCODE=0\n" + script + "\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n")
		_ = file.Close()
		if err != nil {
			return nil, err
		}
		cmd = exec.CommandContext(ctx, binary, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file.Name())
	} else {
		cmd = exec.CommandContext(ctx, "/bin/sh")
		cmd.Stdin = strings.NewReader(script)
	}
	quiet(cmd)
	var stdout, stderr cappedBuffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	cmd.WaitDelay = 3 * time.Second
	err := cmd.Run()
	exit := 0
	if err != nil {
		exit = -1
		if e, ok := err.(*exec.ExitError); ok {
			exit = e.ExitCode()
		}
	}
	result := map[string]any{"stdout": string(stdout.data), "stderr": string(stderr.data), "exit_code": exit, "truncated": stdout.truncated || stderr.truncated}
	if err != nil {
		return result, fmt.Errorf("command exited with status %d", exit)
	}
	return result, nil
}
func hasPowerShell() bool {
	p := "pwsh"
	if runtime.GOOS == "windows" {
		p = "powershell.exe"
	}
	_, e := exec.LookPath(p)
	return e == nil
}

var safeName = regexp.MustCompile(`^[A-Za-z0-9_.@:-]{1,200}$`)
var safeHost = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$`)

func networkCheck(ctx context.Context, p map[string]any) (map[string]any, error) {
	target := text(p, "target")
	if !safeHost.MatchString(target) {
		return nil, errors.New("invalid hostname or IP address")
	}
	kind := text(p, "kind")
	started := time.Now()
	switch kind {
	case "dns":
		addresses, err := net.DefaultResolver.LookupHost(ctx, target)
		return map[string]any{"target": target, "addresses": addresses, "duration_ms": time.Since(started).Milliseconds()}, err
	case "tcp":
		port := number(p, "port", 443)
		if port < 1 || port > 65535 {
			return nil, errors.New("invalid port")
		}
		conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(target, strconv.Itoa(port)))
		if conn != nil {
			conn.Close()
		}
		return map[string]any{"target": target, "port": port, "connected": err == nil, "duration_ms": time.Since(started).Milliseconds()}, err
	case "ping", "trace":
		program := "ping"
		args := []string{"-c", "4", "-W", "2", target}
		if runtime.GOOS == "windows" {
			args = []string{"-n", "4", "-w", "2000", target}
		}
		if kind == "trace" {
			program = "traceroute"
			args = []string{"-n", "-m", "12", "-w", "1", target}
			if runtime.GOOS == "windows" {
				program = "tracert.exe"
				args = []string{"-d", "-h", "12", "-w", "1000", target}
			}
		}
		out, code, err := command(ctx, program, args...)
		return map[string]any{"output": out, "exit_code": code}, err
	}
	return nil, errors.New("unsupported network diagnostic")
}
func listFiles(path string) (map[string]any, error) {
	if path == "" {
		if runtime.GOOS == "windows" {
			path = `C:\`
		} else {
			path = "/"
		}
	}
	path = filepath.Clean(path)
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	rows := []any{}
	for _, e := range entries {
		if len(rows) >= 1000 {
			break
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		rows = append(rows, map[string]any{"name": e.Name(), "path": filepath.Join(path, e.Name()), "directory": e.IsDir(), "symlink": e.Type()&os.ModeSymlink != 0, "size": info.Size(), "modified": info.ModTime().UTC().Format(time.RFC3339)})
	}
	return map[string]any{"path": path, "entries": rows, "truncated": len(entries) > 1000}, nil
}
func (c *Client) uploadToDevice(ctx context.Context, p map[string]any) (map[string]any, error) {
	path := text(p, "path")
	if !filepath.IsAbs(path) {
		return nil, errors.New("destination must be an absolute file path")
	}
	overwrite, _ := p["overwrite"].(bool)
	response, err := c.request(ctx, "GET", "/api/agent/transfers/"+url.PathEscape(text(p, "transfer_id")), nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, errors.New("transfer unavailable")
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".speck-transfer-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(file.Name())
	_ = file.Chmod(0600)
	hash := sha256.New()
	count, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, FileLimit+1))
	if err == nil {
		err = file.Sync()
	}
	_ = file.Close()
	if err != nil {
		return nil, err
	}
	if count > FileLimit {
		return nil, errors.New("file exceeds 256 MiB")
	}
	checksum := hex.EncodeToString(hash.Sum(nil))
	if checksum != text(p, "sha256") {
		return nil, errors.New("file checksum mismatch")
	}
	if overwrite {
		err = replaceFile(file.Name(), path)
	} else {
		err = moveNewFile(file.Name(), path)
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"path": path, "size": count, "sha256": checksum}, nil
}
func (c *Client) downloadFromDevice(ctx context.Context, p map[string]any) (map[string]any, error) {
	path := text(p, "path")
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !stat.Mode().IsRegular() || stat.Size() > FileLimit {
		return nil, errors.New("choose a regular file up to 256 MiB")
	}
	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return nil, err
	}
	checksum := hex.EncodeToString(hash.Sum(nil))
	if _, err = file.Seek(0, 0); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "PUT", c.Config.Server+"/api/agent/transfers/"+url.PathEscape(text(p, "transfer_id")), file)
	if err != nil {
		return nil, err
	}
	req.ContentLength = stat.Size()
	req.Header.Set("Authorization", "Bearer "+c.Config.Token)
	req.Header.Set("X-Speck-Hardware", c.Hardware)
	req.Header.Set("X-Content-SHA256", checksum)
	req.Header.Set("Content-Type", "application/octet-stream")
	response, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("transfer returned HTTP %d", response.StatusCode)
	}
	return map[string]any{"path": path, "size": stat.Size(), "sha256": checksum}, nil
}
func (c *Client) tunnel(ctx context.Context, p map[string]any) (map[string]any, error) {
	port := number(p, "port", 0)
	if port < 1 || port > 65535 {
		return nil, errors.New("invalid tunnel port")
	}
	tcp, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return nil, errors.New("local remote-access service is not listening")
	}
	defer tcp.Close()
	address := "wss" + strings.TrimPrefix(c.Config.Server, "https") + "/api/agent/tunnels/" + url.PathEscape(text(p, "session_id"))
	header := http.Header{"Authorization": []string{"Bearer " + c.Config.Token}, "X-Speck-Hardware": []string{c.Hardware}, "X-Speck-Tunnel-Secret": []string{text(p, "secret")}}
	ws, _, err := websocket.DefaultDialer.DialContext(ctx, address, header)
	if err != nil {
		return nil, errors.New("reverse tunnel connection failed")
	}
	defer ws.Close()
	ws.SetReadLimit(2 * 1024 * 1024)
	errs := make(chan error, 2)
	go func() {
		buffer := make([]byte, 65536)
		for {
			n, err := tcp.Read(buffer)
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
		for {
			kind, value, err := ws.ReadMessage()
			if err != nil {
				errs <- err
				return
			}
			if kind == websocket.BinaryMessage {
				if _, err = tcp.Write(value); err != nil {
					errs <- err
					return
				}
			}
		}
	}()
	select {
	case <-ctx.Done():
	case <-errs:
	}
	return map[string]any{"session": "ended"}, nil
}
func sortedKeys(m map[string]string) []string {
	keys := []string{}
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
