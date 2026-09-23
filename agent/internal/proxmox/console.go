package proxmox

import (
	"context"
	"errors"
	"github.com/gorilla/websocket"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func (c *Client) startConsole(parent context.Context, j Job) Result {
	result := Result{ID: j.ID, Lease: j.Lease, OK: false}
	text := func(key string) string { v, _ := j.Args[key].(string); return v }
	session, secret, password := text("session_id"), text("secret"), text("password")
	vmid, ok := j.Args["vmid"].(float64)
	if !ok || vmid < 100 || vmid != float64(int64(vmid)) || !regexp.MustCompile(`^[a-f0-9]{32}$`).MatchString(session) || len(secret) < 32 || !regexp.MustCompile(`^[a-f0-9]{8}$`).MatchString(password) {
		return result
	}
	ctx, cancel := context.WithTimeout(parent, 2*time.Hour)
	address := "wss" + strings.TrimPrefix(c.Config.Server, "https") + "/api/infrastructure/agent/consoles/" + url.PathEscape(session)
	dialer := websocket.Dialer{HandshakeTimeout: 20 * time.Second, Proxy: nil}
	ws, _, err := dialer.DialContext(ctx, address, http.Header{"Authorization": []string{"Bearer " + c.Config.Token}, "X-Speck-Hardware": []string{c.Config.Hardware}, "X-Speck-Tunnel-Secret": []string{secret}})
	if err != nil {
		cancel()
		return result
	}
	cmd := exec.CommandContext(ctx, "/usr/sbin/qm", "vncproxy", strconv.FormatInt(int64(vmid), 10))
	cmd.Env = append(os.Environ(), "LC_PVE_TICKET="+password)
	cmd.Stderr = io.Discard
	input, e := cmd.StdinPipe()
	if e != nil {
		ws.Close()
		cancel()
		return result
	}
	output, e := cmd.StdoutPipe()
	if e != nil {
		input.Close()
		ws.Close()
		cancel()
		return result
	}
	if e = cmd.Start(); e != nil {
		input.Close()
		output.Close()
		ws.Close()
		cancel()
		return result
	}
	ws.SetReadLimit(2 << 20)
	go func() {
		defer cancel()
		defer ws.Close()
		defer input.Close()
		defer output.Close()
		errorsCh := make(chan error, 2)
		go func() {
			buf := make([]byte, 65536)
			for {
				n, e := output.Read(buf)
				if n > 0 {
					if e2 := ws.WriteMessage(websocket.BinaryMessage, buf[:n]); e2 != nil {
						errorsCh <- e2
						return
					}
				}
				if e != nil {
					errorsCh <- e
					return
				}
			}
		}()
		go func() {
			for {
				kind, data, e := ws.ReadMessage()
				if e != nil {
					errorsCh <- e
					return
				}
				if kind != websocket.BinaryMessage {
					errorsCh <- errors.New("expected binary")
					return
				}
				if _, e = input.Write(data); e != nil {
					errorsCh <- e
					return
				}
			}
		}()
		select {
		case <-ctx.Done():
		case <-errorsCh:
		}
		cancel()
		ws.Close()
		input.Close()
		output.Close()
		_ = cmd.Wait()
	}()
	result.OK = true
	result.Data = map[string]any{"console": "connected"}
	return result
}
