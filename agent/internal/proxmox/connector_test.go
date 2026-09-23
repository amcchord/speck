package proxmox

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
)

func TestCommandAllowlist(t *testing.T) {
	for _, j := range []Job{
		{Method: "GET", Path: "/access/users"},
		{Method: "POST", Path: "/nodes/node/execute", Args: map[string]any{"command": "sh"}},
		{Method: "GET", Path: "/nodes/../storage"},
		{Method: "PUT", Path: "/nodes/node/qemu/101/config", Args: map[string]any{"hookscript": "evil"}},
		{Method: "POST", Path: "/nodes/node/status", Args: map[string]any{"command": "shell"}},
		{Method: "DELETE", Path: "/nodes/node/qemu/9000"},
		{Method: "POST", Path: "/nodes/node/qemu/101/clone", Args: map[string]any{"name": "--help"}},
	} {
		if _, e := Command(j); e == nil {
			t.Fatalf("accepted forbidden request %#v", j)
		}
	}
	args, e := Command(Job{Method: "PUT", Path: "/nodes/pve-01/qemu/101/config", Args: map[string]any{"cores": float64(4), "memory": float64(8192)}})
	if e != nil || len(args) != 8 {
		t.Fatalf("valid argv: %v %v", args, e)
	}
	if _, e = Command(Job{Method: "POST", Path: "/nodes/pve-01/qemu/9000/clone", Args: map[string]any{"newid": float64(123), "name": "new-guest", "full": float64(1)}}); e != nil {
		t.Fatal(e)
	}
}

func TestJournalRestartNeverReexecutes(t *testing.T) {
	for _, completed := range []bool{false, true} {
		t.Run(map[bool]string{false: "interrupted", true: "completed"}[completed], func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "agent.json")
			j := Journal{Job: Job{ID: "job", Lease: "lease", Method: "POST", Path: "/nodes/node/qemu/101/status/reboot"}, Result: Result{ID: "job", Lease: "lease", OK: completed}}
			if e := writeJSON(filepath.Join(dir, "request.json"), j); e != nil {
				t.Fatal(e)
			}
			info, _ := os.Stat(filepath.Join(dir, "request.json"))
			if info.Mode().Perm() != 0600 {
				t.Fatal("journal is not private")
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var sent atomic.Int32
			var executed atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/infrastructure/agent/result" {
					var result Result
					_ = json.NewDecoder(r.Body).Decode(&result)
					if result.OK != completed || result.ID != "job" {
						t.Error("journal result changed")
					}
					sent.Add(1)
					cancel()
				}
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer srv.Close()
			c := &Client{Config: Config{Server: srv.URL}, HTTP: srv.Client()}
			if e := runLoop(ctx, path, c, func(context.Context, Job) Result { executed.Add(1); return Result{} }); e != nil {
				t.Fatal(e)
			}
			if executed.Load() != 0 || sent.Load() != 1 {
				t.Fatalf("executed=%d sent=%d", executed.Load(), sent.Load())
			}
		})
	}
}

func TestInvalidServerAndOutputBound(t *testing.T) {
	for _, s := range []string{"http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?secret=yes"} {
		if validServer(s) {
			t.Fatal("accepted", s)
		}
	}
	var b bounded
	if _, e := b.Write(make([]byte, (8<<20)+1)); e == nil {
		t.Fatal("unbounded output")
	}
}

func TestInventoryIdentityDoesNotExposeConfigSecrets(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "pve", "qemu-server")
	if e := os.MkdirAll(dir, 0700); e != nil {
		t.Fatal(e)
	}
	text := "smbios1: uuid=a1234567-1234-1234-1234-123456789012\nnet0: virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0\nagent: 1\ncipassword: secret-password\n[snapshot]\nsmbios1: uuid=ffffffff-ffff-ffff-ffff-ffffffffffff\n"
	if e := os.WriteFile(filepath.Join(dir, "101.conf"), []byte(text), 0600); e != nil {
		t.Fatal(e)
	}
	rows := []any{map[string]any{"type": "qemu", "node": "pve", "vmid": float64(101)}}
	enrichInventory(rows, root)
	encoded, _ := json.Marshal(rows)
	if bytes.Contains(encoded, []byte("secret-password")) || bytes.Contains(encoded, []byte("ffffffff")) {
		t.Fatal("exposed other configuration")
	}
	identity := rows[0].(map[string]any)["speck_identity"].(map[string]any)
	if identity["guest_agent"] != true || identity["uuid"] != "a1234567-1234-1234-1234-123456789012" {
		t.Fatalf("bad identity %#v", identity)
	}
}

func TestGuestCommandArgumentsRemainLiteral(t *testing.T) {
	args, e := Command(Job{Method: "POST", Path: "/nodes/pve/qemu/101/agent/exec", Args: map[string]any{"command": []any{"/bin/sh", "-c", "printf '%s' '$HOME'"}}})
	if e != nil {
		t.Fatal(e)
	}
	if args[len(args)-1] != "--command=printf '%s' '$HOME'" {
		t.Fatalf("changed command %#v", args)
	}
}

func TestHostIdentityFallbackRemainsPinned(t *testing.T) {
	values := map[string]string{
		"/etc/machine-id":                "",
		"/sys/class/dmi/id/product_uuid": "A1234567-1234-1234-1234-123456789012\n",
	}
	read := func(path string) ([]byte, error) { return []byte(values[path]), nil }
	id, source, err := hostIdentity("", read)
	if err != nil || source != "dmi-uuid" || len(id) != 64 {
		t.Fatalf("fallback: %q %v", source, err)
	}
	values["/etc/machine-id"] = "new-machine-id-123456789"
	got, _, err := hostIdentity(source, read)
	if err != nil || got != id {
		t.Fatal("enrollment changed when machine-id appeared")
	}
	legacy, selected, err := hostIdentity("machine-id", read)
	if err != nil || selected != "machine-id" || legacy == id {
		t.Fatal("legacy identity changed")
	}
	values["/etc/machine-id"] = ""
	if _, _, err := hostIdentity("machine-id", read); err == nil {
		t.Fatal("silently changed pinned source")
	}
	for _, value := range []string{"", "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff", "not-a-valid-hardware-uuid"} {
		values["/sys/class/dmi/id/product_uuid"] = value
		if _, _, err := hostIdentity("", read); err == nil {
			t.Fatal("accepted invalid identity")
		}
	}
}
