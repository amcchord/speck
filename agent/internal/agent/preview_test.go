package agent

import (
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
