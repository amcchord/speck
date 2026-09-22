package agent

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPreviewStopsOnExpiredOrDisabledPolicy(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "telemetry")
	_ = os.MkdirAll(dir, 0700)
	name := filepath.Join(dir, foregroundFilename()[:len(foregroundFilename())-5]+".preview")
	for _, p := range []PreviewPolicy{{Enabled: false, Expires: float64(time.Now().Unix() + 30)}, {Enabled: true, Expires: float64(time.Now().Unix() - 30)}} {
		if err := writeJSON(filepath.Join(root, "public", "preview.json"), p, 0644); err != nil {
			t.Fatal(err)
		}
		_ = os.WriteFile(name, []byte("previous frame"), 0600)
		WritePreview(dir)
		if _, err := os.Stat(name); !os.IsNotExist(err) {
			t.Fatal("expired or disabled preview was retained")
		}
	}
}

func TestCaptureProcessTimeoutAndRecovery(t *testing.T) {
	if os.Getenv("SPECK_TEST_CAPTURE_CHILD") == "hang" {
		time.Sleep(time.Minute)
		return
	}
	if os.Getenv("SPECK_TEST_CAPTURE_CHILD") == "recover" {
		return
	}
	dir := t.TempDir()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("SPECK_TEST_CAPTURE_CHILD", "hang")
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	start := time.Now()
	capturePreviewProcess(ctx, dir, executable, "-test.run=^TestCaptureProcessTimeoutAndRecovery$")
	if time.Since(start) > 5*time.Second {
		t.Fatal("capture did not terminate promptly")
	}
	name := filepath.Join(dir, foregroundFilename()[:len(foregroundFilename())-5]+".preview-status")
	data, err := os.ReadFile(name)
	var report PreviewStatus
	if err != nil || json.Unmarshal(data, &report) != nil || report.State != "capture_timeout" {
		t.Fatalf("missing timeout status: %s %v", data, err)
	}
	// The next capture can start; there is no stuck worker or permanent busy flag.
	t.Setenv("SPECK_TEST_CAPTURE_CHILD", "recover")
	ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel2()
	capturePreviewProcess(ctx2, dir, executable, "-test.run=^TestCaptureProcessTimeoutAndRecovery$")
	if ctx2.Err() != nil {
		t.Fatal("next capture did not recover")
	}
}
