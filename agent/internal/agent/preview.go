package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
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
type PreviewStatus struct {
	State      string `json:"state"`
	ObservedAt int64  `json:"observed_at"`
}

func writePreviewStatus(dir, state string) {
	name := strings.TrimSuffix(foregroundFilename(), ".json") + ".preview-status"
	_ = writeJSON(filepath.Join(dir, name), PreviewStatus{state, time.Now().Unix()}, 0600)
}

// Each capture runs in a disposable child: disconnected display drivers can
// block indefinitely inside native capture calls. Never block foreground reporting.
func RunObserver(dir string) {
	go func() {
		executable, err := os.Executable()
		if err != nil {
			return
		}
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			capturePreviewProcess(ctx, dir, executable, "capture-preview", dir)
			cancel()
			time.Sleep(10 * time.Second)
		}
	}()
	for {
		WriteForeground(dir)
		time.Sleep(2 * time.Second)
	}
}

func capturePreviewProcess(ctx context.Context, dir, executable string, args ...string) {
	cmd := exec.CommandContext(ctx, executable, args...)
	quiet(cmd)
	if err := cmd.Run(); err != nil {
		state := "capture_failed"
		if ctx.Err() != nil {
			state = "capture_timeout"
		}
		_ = os.Remove(filepath.Join(dir, strings.TrimSuffix(foregroundFilename(), ".json")+".preview"))
		writePreviewStatus(dir, state)
	}
}

func WritePreview(dir string) {
	state := "capture_failed"
	defer func() {
		if recover() != nil {
			state = "capture_failed"
		}
		if state != "live" {
			_ = os.Remove(filepath.Join(dir, strings.TrimSuffix(foregroundFilename(), ".json")+".preview"))
		}
		writePreviewStatus(dir, state)
	}()
	name := filepath.Join(dir, strings.TrimSuffix(foregroundFilename(), ".json")+".preview")
	data, err := os.ReadFile(filepath.Join(filepath.Dir(dir), "public", "preview.json"))
	var p PreviewPolicy
	if err != nil || json.Unmarshal(data, &p) != nil || !p.Enabled || float64(time.Now().Unix()) >= p.Expires {
		state = "disabled"
		return
	}
	if reason := previewDesktopState(); reason != "" {
		state = reason
		return
	}
	if screenshot.NumActiveDisplays() == 0 {
		state = "no_desktop"
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
	// Recheck consent after native capture, which may have taken several seconds.
	data, err = os.ReadFile(filepath.Join(filepath.Dir(dir), "public", "preview.json"))
	if err != nil || json.Unmarshal(data, &p) != nil || !p.Enabled || float64(time.Now().Unix()) >= p.Expires {
		state = "disabled"
		return
	}
	if writeJSON(name, frame, 0600) == nil {
		state = "live"
	}
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
		status := PreviewStatus{State: "helper_unavailable"}
		for _, f := range files {
			if f.Type()&os.ModeSymlink != 0 {
				continue
			}
			if filepath.Ext(f.Name()) == ".preview-status" {
				info, e := f.Info()
				if e != nil || info.Size() > 2048 || time.Since(info.ModTime()) > 30*time.Second {
					continue
				}
				b, e := os.ReadFile(filepath.Join(dir, "telemetry", f.Name()))
				var report PreviewStatus
				if e == nil && json.Unmarshal(b, &report) == nil && report.ObservedAt > time.Now().Unix()-30 && report.ObservedAt > status.ObservedAt {
					status = report
				}
				continue
			}
			if filepath.Ext(f.Name()) != ".preview" {
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
			if c.api(ctx, "PUT", "/api/agent/preview", latest, nil) == nil {
				status.State = "live"
			}
		}
		if p.Enabled {
			if status.State == "disabled" {
				status.State = "helper_unavailable"
			}
			_ = c.api(ctx, "PUT", "/api/agent/preview-status", map[string]string{"state": status.State}, nil)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(10 * time.Second):
		}
	}
}
