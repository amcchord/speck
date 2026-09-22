package agent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const Version = "0.2.0"
const FileLimit = int64(256 * 1024 * 1024)

type Config struct {
	Server         string `json:"server"`
	Token          string `json:"token"`
	InstallationID string `json:"installation_id"`
}
type Client struct {
	Config     Config
	Hardware   string
	HTTP       *http.Client
	ConfigPath string
	mu         sync.Mutex
	completed  map[string]Result
}
type Job struct {
	ID      string         `json:"id"`
	Kind    string         `json:"kind"`
	Payload map[string]any `json:"payload"`
	Lease   string         `json:"lease"`
}
type Result struct {
	Status string         `json:"status"`
	Result map[string]any `json:"result"`
}

func DefaultConfig() string {
	if runtime.GOOS == "windows" {
		return `C:\ProgramData\Speck\agent.json`
	}
	return "/etc/speck/agent.json"
}
func newClient(c Config, path string) *Client {
	return &Client{Config: c, Hardware: hardwareID(), HTTP: &http.Client{Timeout: 190 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error { return errors.New("redirect refused") }}, ConfigPath: path, completed: map[string]Result{}}
}
func (c *Client) request(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.Config.Server+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Config.Token)
	req.Header.Set("X-Speck-Hardware", c.Hardware)
	return c.HTTP.Do(req)
}
func (c *Client) api(ctx context.Context, method, path string, in, out any) error {
	// Control messages must recover promptly after an endpoint changes networks.
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var body io.Reader
	if in != nil {
		data, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	resp, err := c.request(ctx, method, path, body)
	if err != nil {
		return fmt.Errorf("server connection failed: %T", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("server returned HTTP %d", resp.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(resp.Body, 4*1024*1024)).Decode(out)
	}
	return nil
}
func Enroll(path, server, token string) error {
	u, err := url.Parse(server)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" {
		return errors.New("enrollment requires an HTTPS server origin")
	}
	if _, err := os.Stat(path); err == nil {
		return errors.New("agent is already enrolled; existing credentials preserved")
	}
	c := newClient(Config{Server: strings.TrimRight(server, "/")}, path)
	hostname, _ := os.Hostname()
	input := map[string]any{"token": token, "hardware_id": c.Hardware, "hostname": hostname, "platform": runtime.GOOS, "arch": runtime.GOARCH}
	var response struct {
		Token          string `json:"token"`
		InstallationID string `json:"installation_id"`
	}
	if err := c.api(context.Background(), "POST", "/api/agent/enroll", input, &response); err != nil {
		return err
	}
	c.Config.Token = response.Token
	c.Config.InstallationID = response.InstallationID
	return writeJSON(path, c.Config, 0600)
}
func writeJSON(path string, value any, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(path), ".speck-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if err = temp.Chmod(mode); err == nil {
		_, err = temp.Write(data)
	}
	if err == nil {
		err = temp.Sync()
	}
	closeErr := temp.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return replaceFile(name, path)
}
func Run(ctx context.Context, path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return errors.New("agent configuration is unavailable")
	}
	var cfg Config
	if json.Unmarshal(data, &cfg) != nil {
		return errors.New("invalid agent configuration")
	}
	c := newClient(cfg, path)
	// WMI may not be ready on the first boot after a restore. Keep retrying
	// without checking in under an empty or fallback identity.
	for c.Hardware == "" {
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(10 * time.Second):
			c.Hardware = hardwareID()
		}
	}
	if data, err := os.ReadFile(filepath.Join(filepath.Dir(path), "completed.json")); err == nil {
		_ = json.Unmarshal(data, &c.completed)
	}
	var telemetry map[string]any
	var telemetryMu sync.RWMutex
	go func() {
		for {
			collected := Collect(filepath.Join(filepath.Dir(path), "telemetry"))
			telemetryMu.Lock()
			telemetry = collected
			telemetryMu.Unlock()
			select {
			case <-ctx.Done():
				return
			case <-time.After(30 * time.Second):
			}
		}
	}()
	go func() {
		for {
			telemetryMu.RLock()
			current := telemetry
			telemetryMu.RUnlock()
			if current != nil {
				hostname, _ := os.Hostname()
				_ = c.api(ctx, "POST", "/api/agent/check-in", map[string]any{"hostname": hostname, "platform": runtime.GOOS, "arch": runtime.GOARCH, "telemetry": current}, nil)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(15 * time.Second):
			}
		}
	}()
	go c.previewLoop(ctx)
	slots := make(chan struct{}, 4)
	for {
		var response struct {
			Job *Job `json:"job"`
		}
		timeout, cancel := context.WithTimeout(ctx, 20*time.Second)
		err := c.api(timeout, "GET", "/api/agent/jobs/next", nil, &response)
		cancel()
		if err == nil && response.Job != nil {
			select {
			case slots <- struct{}{}:
				go func(job Job) { defer func() { <-slots }(); c.execute(ctx, job) }(*response.Job)
			case <-ctx.Done():
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(2 * time.Second):
		}
	}
}
func (c *Client) execute(parent context.Context, j Job) {
	c.mu.Lock()
	cached, done := c.completed[j.ID]
	c.mu.Unlock()
	if done {
		_ = c.report(parent, j, cached)
		return
	}
	// Persist an execution marker before starting: an interrupted command never replays.
	if err := c.remember(j.ID, Result{Status: "failed", Result: map[string]any{"error": "Agent restarted before this job's outcome was recorded; command was not replayed"}}); err != nil {
		_ = c.report(parent, j, Result{Status: "failed", Result: map[string]any{"error": "Cannot persist execution marker; command was not run"}})
		return
	}
	if err := c.report(parent, j, Result{Status: "running", Result: map[string]any{}}); err != nil {
		return
	}
	duration := number(j.Payload, "timeout", 60)
	if j.Kind != "tunnel" && j.Kind != "command" && duration > 180 {
		duration = 180
	}
	if duration < 5 {
		duration = 5
	}
	if duration > 7200 {
		duration = 7200
	}
	ctx, cancel := context.WithTimeout(parent, time.Duration(duration)*time.Second)
	defer cancel()
	result, err := c.handle(ctx, j)
	status := "complete"
	if result == nil {
		result = map[string]any{}
	}
	if err != nil {
		status = "failed"
		result["error"] = err.Error()
	}
	if ctx.Err() != nil {
		status = "failed"
		result["error"] = "Job timed out or agent stopped"
	}
	outcome := Result{Status: status, Result: result}
	_ = c.remember(j.ID, outcome)
	for i := 0; i < 3; i++ {
		if c.report(parent, j, outcome) == nil {
			return
		}
		select {
		case <-parent.Done():
			return
		case <-time.After(time.Duration(i+1) * time.Second):
		}
	}
}
func (c *Client) remember(id string, r Result) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.completed) > 2000 {
		c.completed = map[string]Result{}
	}
	c.completed[id] = r
	return writeJSON(filepath.Join(filepath.Dir(c.ConfigPath), "completed.json"), c.completed, 0600)
}
func (c *Client) report(ctx context.Context, j Job, r Result) error {
	return c.api(ctx, "POST", "/api/agent/jobs/"+j.ID, map[string]any{"lease": j.Lease, "status": r.Status, "result": r.Result}, nil)
}
func (c *Client) handle(ctx context.Context, j Job) (map[string]any, error) {
	switch j.Kind {
	case "command":
		return runScript(ctx, text(j.Payload, "shell"), text(j.Payload, "script"))
	case "service.control":
		return controlService(ctx, text(j.Payload, "name"), text(j.Payload, "action"))
	case "network.check":
		return networkCheck(ctx, j.Payload)
	case "files.list":
		return listFiles(text(j.Payload, "path"))
	case "files.upload":
		return c.uploadToDevice(ctx, j.Payload)
	case "files.download":
		return c.downloadFromDevice(ctx, j.Payload)
	case "tunnel":
		return c.tunnel(ctx, j.Payload)
	}
	return nil, errors.New("unsupported job")
}
func text(m map[string]any, key string) string { v, _ := m[key].(string); return v }
func number(m map[string]any, key string, def int) int {
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return def
}
func sum(data []byte) string { hash := sha256.Sum256(data); return hex.EncodeToString(hash[:]) }
