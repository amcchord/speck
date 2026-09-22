//go:build linux

package agent

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScriptFailureAndOutputLimit(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r, err := runScript(ctx, "sh", "printf proof; exit 7")
	if err == nil || r["exit_code"] != 7 || r["stdout"] != "proof" {
		t.Fatalf("failed command lost its outcome: %v", r)
	}
	r, err = runScript(ctx, "sh", "head -c 100000 /dev/zero")
	if err != nil || r["truncated"] != true || len(r["stdout"].(string)) != 65536 {
		t.Fatal("output limit failed")
	}
}
func TestNoOverwriteTransferPrimitive(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source")
	dst := filepath.Join(dir, "existing")
	os.WriteFile(src, []byte("new"), 0600)
	os.WriteFile(dst, []byte("original"), 0600)
	if moveNewFile(src, dst) == nil {
		t.Fatal("existing file was overwritten")
	}
	value, _ := os.ReadFile(dst)
	if string(value) != "original" {
		t.Fatal("original contents changed")
	}
}
func TestPersistenceFailureRefusesMarker(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file")
	os.WriteFile(path, []byte("not a directory"), 0600)
	c := &Client{ConfigPath: filepath.Join(path, "agent.json"), completed: map[string]Result{}}
	if c.remember("job", Result{Status: "failed"}) == nil {
		t.Fatal("persistence failure was ignored")
	}
}
