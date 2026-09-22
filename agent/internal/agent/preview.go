package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/kbinani/screenshot"
)

type PreviewPolicy struct {
	Enabled bool    `json:"enabled"`
	Expires float64 `json:"expires"`
}
type PreviewFrame struct {
	JPEG       string  `json:"jpeg"`
	CapturedAt float64 `json:"captured_at"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
}

// Capture only in an interactive user session, under a short, server-issued lease.
// Screens are never added to general telemetry, logs or the completed-job journal.
func WritePreview(dir string) {
	defer func() { _ = recover() }()
	name := filepath.Join(dir, strings.TrimSuffix(foregroundFilename(), ".json")+".preview")
	data, err := os.ReadFile(filepath.Join(filepath.Dir(dir), "public", "preview.json"))
	var p PreviewPolicy
	if err != nil || json.Unmarshal(data, &p) != nil || !p.Enabled || float64(time.Now().Unix()) >= p.Expires {
		_ = os.Remove(name)
		return
	}
	if runtime.GOOS == "linux" && (os.Getenv("DISPLAY") == "" || os.Getenv("XDG_SESSION_TYPE") == "wayland") {
		return
	}
	// A headless or locked session has no usable display; do not manufacture a frame.
	if foreground() == nil || screenshot.NumActiveDisplays() == 0 {
		_ = os.Remove(name)
		return
	}
	bounds := screenshot.GetDisplayBounds(0)
	if bounds.Dx() < 1 || bounds.Dy() < 1 || bounds.Dx() > 16000 || bounds.Dy() > 16000 {
		return
	}
	img, err := screenshot.CaptureRect(bounds)
	if err != nil {
		return
	}
	width, height := 640, 640*bounds.Dy()/bounds.Dx()
	if height > 640 {
		height = 640
		width = 640 * bounds.Dx() / bounds.Dy()
	}
	if width < 1 || height < 1 {
		return
	}
	small := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			small.Set(x, y, img.At(x*img.Bounds().Dx()/width, y*img.Bounds().Dy()/height))
		}
	}
	var buf bytes.Buffer
	if jpeg.Encode(&buf, small, &jpeg.Options{Quality: 65}) != nil || buf.Len() > 200000 {
		return
	}
	frame := PreviewFrame{base64.StdEncoding.EncodeToString(buf.Bytes()), float64(time.Now().Unix()), width, height}
	_ = writeJSON(name, frame, 0600)
}

func (c *Client) previewLoop(ctx context.Context) {
	dir := filepath.Dir(c.ConfigPath)
	policyFile := filepath.Join(dir, "public", "preview.json")
	defer os.Remove(policyFile)
	for {
		var p PreviewPolicy
		err := c.api(ctx, "GET", "/api/agent/preview-policy", nil, &p)
		if err != nil {
			p = PreviewPolicy{}
		}
		_ = writeJSON(policyFile, p, 0644)
		files, _ := os.ReadDir(filepath.Join(dir, "telemetry"))
		var latest PreviewFrame
		for _, f := range files {
			if f.Type()&os.ModeSymlink != 0 || filepath.Ext(f.Name()) != ".preview" {
				continue
			}
			path := filepath.Join(dir, "telemetry", f.Name())
			info, e := f.Info()
			if e != nil || info.Size() > 280000 {
				continue
			}
			if !p.Enabled || time.Since(info.ModTime()) > 30*time.Second {
				_ = os.Remove(path)
				continue
			}
			b, e := os.ReadFile(path)
			var frame PreviewFrame
			if e == nil && json.Unmarshal(b, &frame) == nil && frame.CapturedAt > latest.CapturedAt {
				latest = frame
			}
		}
		if p.Enabled && latest.CapturedAt > float64(time.Now().Unix()-30) {
			_ = c.api(ctx, "PUT", "/api/agent/preview", latest, nil)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
		}
	}
}
