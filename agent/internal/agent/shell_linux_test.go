//go:build linux

package agent

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestDisplayState(t *testing.T) {
	dir := t.TempDir()
	for _, kind := range []string{"x11", "wayland"} {
		if err := os.WriteFile(filepath.Join(dir, "c1"), []byte("STATE=online\nTYPE="+kind+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if state := displayState(dir); state != "available" {
			t.Fatalf("locked %s desktop: %s", kind, state)
		}
	}
	if state := displayState(filepath.Join(dir, "missing")); state != "unknown" {
		t.Fatalf("missing logind: %s", state)
	}
	if err := os.Remove(filepath.Join(dir, "c1")); err != nil {
		t.Fatal(err)
	}
	if state := displayState(dir); state != "headless" {
		t.Fatalf("empty session directory: %s", state)
	}
}

func TestInteractiveShellTunnel(t *testing.T) {
	t.Setenv("SPECK_PRIVATE_TEST", "must-not-inherit")
	proof := make(chan error, 1)
	upgrader := websocket.Upgrader{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" || r.Header.Get("X-Speck-Hardware") != "test-hardware" || r.Header.Get("X-Speck-Tunnel-Secret") != "one-session" {
			proof <- fmt.Errorf("missing authentication")
			return
		}
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			proof <- err
			return
		}
		defer ws.Close()
		_ = ws.SetReadDeadline(time.Now().Add(10 * time.Second))
		_, first, err := ws.ReadMessage()
		if err != nil || string(first) != "{\"type\":\"ready\"}\n" {
			proof <- fmt.Errorf("ready: %s %v", first, err)
			return
		}
		readUntil := func(expected string) error {
			output := ""
			for !strings.Contains(output, expected) {
				_, data, err := ws.ReadMessage()
				if err != nil {
					return fmt.Errorf("waiting for %q in %q: %w", expected, output, err)
				}
				output += string(data)
			}
			return nil
		}
		// Disable echo so the proof must be command output, not typed input.
		_ = ws.WriteJSON(map[string]any{"type": "input", "data": "stty -echo; printf 'ready-%s\\n' proof\r"})
		if err := readUntil("ready-proof"); err != nil {
			proof <- err
			return
		}
		_ = ws.WriteJSON(map[string]any{"type": "resize", "cols": 123, "rows": 42})
		_ = ws.WriteJSON(map[string]any{"type": "input", "data": "stty size; printf 'unicode: café 漢字\\n'; printf 'env:%s\\n' \"${SPECK_PRIVATE_TEST-unset}\"\r"})
		output := ""
		for !strings.Contains(output, "env:unset") {
			_, data, err := ws.ReadMessage()
			if err != nil {
				proof <- err
				return
			}
			output += string(data)
		}
		if !strings.Contains(output, "42 123") || !strings.Contains(output, "café 漢字") {
			proof <- fmt.Errorf("terminal output: %q", output)
			return
		}
		// Interrupt a foreground job, then prove the interactive shell still works.
		_ = ws.WriteJSON(map[string]any{"type": "input", "data": "sleep 30\r"})
		time.Sleep(100 * time.Millisecond)
		_ = ws.WriteJSON(map[string]any{"type": "input", "data": "\x03"})
		_ = ws.WriteJSON(map[string]any{"type": "input", "data": "printf 'interrupt-%s\\n' proof\r"})
		if err := readUntil("interrupt-proof"); err != nil {
			proof <- err
			return
		}
		_ = ws.WriteJSON(map[string]any{"type": "input", "data": "sleep 30\r"})
		time.Sleep(100 * time.Millisecond)
		proof <- nil
	}))
	defer server.Close()
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	previous := websocket.DefaultDialer
	websocket.DefaultDialer = &websocket.Dialer{TLSClientConfig: &tls.Config{RootCAs: roots}}
	defer func() { websocket.DefaultDialer = previous }()
	client := &Client{Config: Config{Server: server.URL, Token: "test-token"}, Hardware: "test-hardware"}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var payload map[string]any
	_ = json.Unmarshal([]byte(`{"session_id":"test","secret":"one-session","cols":100,"rows":30}`), &payload)
	ended := make(chan error, 1)
	go func() { _, err := client.shell(ctx, payload); ended <- err }()
	select {
	case err := <-proof:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("shell proof timed out")
	}
	select {
	case err := <-ended:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shell did not close and reap on disconnect")
	}
}
