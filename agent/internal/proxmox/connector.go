// Package proxmox implements an outbound-only, allowlisted Proxmox API connector.
package proxmox

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
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const Version = "0.1.0"
const DefaultConfig = "/etc/speck-proxmox/agent.json"

type Config struct {
	Server   string `json:"server"`
	Token    string `json:"token"`
	ID       string `json:"id"`
	Hardware string `json:"hardware"`
}
type Job struct {
	ID     string         `json:"id"`
	Lease  string         `json:"lease"`
	Method string         `json:"method"`
	Path   string         `json:"path"`
	Args   map[string]any `json:"args"`
}
type Result struct {
	ID    string `json:"id"`
	Lease string `json:"lease"`
	OK    bool   `json:"ok"`
	Data  any    `json:"data"`
}
type Journal struct {
	Job    Job    `json:"job"`
	Result Result `json:"result"`
}
type Client struct {
	Config Config
	HTTP   *http.Client
}

func client(cfg Config) *Client {
	return &Client{cfg, &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("redirect refused") }}}
}
func validServer(s string) bool {
	u, e := url.Parse(s)
	return e == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && (u.Path == "" || u.Path == "/")
}
func (c *Client) api(ctx context.Context, method, path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, e := json.Marshal(in)
		if e != nil {
			return e
		}
		body = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, method, c.Config.Server+"/api/infrastructure/agent"+path, body)
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Config.Token)
	req.Header.Set("X-Speck-Hardware", c.Config.Hardware)
	resp, e := c.HTTP.Do(req)
	if e != nil {
		return errors.New("control plane unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("control plane HTTP %d", resp.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out)
	}
	return nil
}
func writeJSON(path string, value any) error {
	if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	b, e := json.Marshal(value)
	if e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(path), ".speck-proxmox-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	if e = os.Rename(f.Name(), path); e != nil {
		return e
	}
	d, e := os.Open(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer d.Close()
	return d.Sync()
}
func Enroll(path, server, token string) error {
	if !validServer(server) {
		return errors.New("an HTTPS Speck server origin is required")
	}
	if _, e := os.Stat(path); !os.IsNotExist(e) {
		return errors.New("existing enrollment preserved")
	}
	if _, e := os.Stat("/usr/bin/pvesh"); e != nil {
		return errors.New("this is not a Proxmox host")
	}
	machine, e := os.ReadFile("/etc/machine-id")
	if e != nil || len(bytes.TrimSpace(machine)) < 16 {
		return errors.New("host identity unavailable")
	}
	sum := sha256.Sum256(bytes.TrimSpace(machine))
	hardware := hex.EncodeToString(sum[:])
	host, e := os.Hostname()
	if e != nil {
		return e
	}
	c := client(Config{Server: strings.TrimRight(server, "/"), Hardware: hardware})
	var response struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	if e = c.api(context.Background(), "POST", "/enroll", map[string]string{"token": token, "hardware": hardware, "hostname": host, "version": Version}, &response); e != nil {
		return e
	}
	c.Config.ID = response.ID
	c.Config.Token = response.Token
	return writeJSON(path, c.Config)
}

type rule struct{ method, path, keys string }

var rules = []rule{
	{"GET", `/nodes/[A-Za-z0-9_-]+(/(qemu|lxc)/[0-9]+)?/rrddata`, "timeframe"},
	{"GET", `/nodes/[A-Za-z0-9_-]+/(qemu|lxc)/[0-9]+/snapshot`, ""},
	{"POST", `/nodes/[A-Za-z0-9_-]+/(qemu|lxc)/[0-9]+/snapshot`, "snapname"},
	{"POST", `/nodes/[A-Za-z0-9_-]+/(qemu|lxc)/[0-9]+/snapshot/[A-Za-z][A-Za-z0-9_-]+/rollback`, ""},
	{"DELETE", `/nodes/[A-Za-z0-9_-]+/(qemu|lxc)/[0-9]+/snapshot/[A-Za-z][A-Za-z0-9_-]+`, ""},
	{"GET", `/nodes/[A-Za-z0-9_-]+/qemu/[0-9]+/agent/(network-get-interfaces|get-osinfo|get-fsinfo)`, ""},
	{"GET", `/nodes/[A-Za-z0-9_-]+/qemu/[0-9]+/agent/exec-status`, "pid"},
	{"GET", `/nodes/[A-Za-z0-9_-]+/qemu/[0-9]+/agent/file-read`, "file count"},
	{"POST", `/nodes/[A-Za-z0-9_-]+/qemu/[0-9]+/agent/file-write`, "file content"},
	{"POST", `/nodes/[A-Za-z0-9_-]+/qemu/[0-9]+/agent/exec`, "command"},
	{"GET", `/cluster/resources`, ""},
	{"GET", `/nodes/[A-Za-z0-9_-]+/(status|storage|network)`, ""},
	{"GET", `/nodes/[A-Za-z0-9_-]+/tasks`, "limit vmid"},
	{"GET", `/nodes/[A-Za-z0-9_-]+/(qemu|lxc)/[0-9]+/(status/current|config)`, ""},
	{"POST", `/nodes/[A-Za-z0-9_-]+/status`, "command"},
	{"POST", `/nodes/[A-Za-z0-9_-]+/(qemu|lxc)/[0-9]+/status/(start|shutdown|reboot|stop)`, ""},
	{"PUT", `/nodes/[A-Za-z0-9_-]+/(qemu|lxc)/[0-9]+/config`, "cores memory"},
	{"POST", `/nodes/[A-Za-z0-9_-]+/(qemu|lxc)/[0-9]+/migrate`, "target online restart with-local-disks"},
	{"POST", `/nodes/[A-Za-z0-9_-]+/qemu/[0-9]+/clone`, "newid name target storage full"},
	{"DELETE", `/nodes/[A-Za-z0-9_-]+/(qemu|lxc)/[0-9]+`, ""},
}

// Command constructs argv, never a shell command; paths and flags are closed lists.
func Command(j Job) ([]string, error) {
	method := map[string]string{"GET": "get", "POST": "create", "PUT": "set", "DELETE": "delete"}[j.Method]
	if method == "" {
		return nil, errors.New("unsupported method")
	}
	for _, r := range rules {
		if j.Method != r.method || !regexp.MustCompile("^"+r.path+"$").MatchString(j.Path) {
			continue
		}
		if j.Method != "GET" && regexp.MustCompile(`/(qemu|lxc)/(9000|9001)(/|$)`).MatchString(j.Path) && !strings.HasSuffix(j.Path, "/clone") {
			return nil, errors.New("protected template")
		}
		allowed := map[string]bool{}
		for _, k := range strings.Fields(r.keys) {
			allowed[k] = true
		}
		keys := []string{}
		for k := range j.Args {
			if !allowed[k] {
				return nil, errors.New("unsupported argument")
			}
			keys = append(keys, k)
		}
		sort.Strings(keys)
		args := []string{method, j.Path, "--output-format", "json"}
		for _, k := range keys {
			if k == "command" && strings.HasSuffix(j.Path, "/agent/exec") {
				values, ok := j.Args[k].([]any)
				if !ok || len(values) < 1 || len(values) > 8 {
					return nil, errors.New("invalid guest command")
				}
				for _, value := range values {
					text, ok := value.(string)
					if !ok || len(text) > 32768 || strings.Contains(text, "\x00") {
						return nil, errors.New("invalid command argument")
					}
					args = append(args, "--command="+text)
				}
				continue
			}
			var v string
			switch value := j.Args[k].(type) {
			case string:
				v = value
			case float64:
				if value != float64(int64(value)) {
					return nil, errors.New("noninteger argument")
				}
				v = strconv.FormatInt(int64(value), 10)
			case int:
				v = strconv.Itoa(value)
			default:
				return nil, errors.New("invalid argument type")
			}
			if len(v) > 8192 || strings.Contains(v, "\x00") || (k != "content" && strings.ContainsAny(v, "\r\n")) || strings.HasPrefix(v, "-") {
				return nil, errors.New("invalid argument value")
			}
			if k == "command" && v != "reboot" && v != "shutdown" {
				return nil, errors.New("invalid power command")
			}
			args = append(args, "--"+k, v)
		}
		return args, nil
	}
	return nil, errors.New("operation not allowed")
}

// A bounded writer prevents unexpected provider output from exhausting host RAM.
type bounded struct{ bytes.Buffer }

func (b *bounded) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 8<<20 {
		return 0, errors.New("output limit")
	}
	return b.Buffer.Write(p)
}
func execute(ctx context.Context, j Job) Result {
	result := Result{ID: j.ID, Lease: j.Lease, OK: false}
	if j.Method == "GET" && j.Path == "/speck/inventory" && len(j.Args) == 0 {
		raw := j
		raw.Path = "/cluster/resources"
		result = execute(ctx, raw)
		if result.OK {
			enrichInventory(result.Data, "/etc/pve/nodes")
		}
		return result
	}
	args, e := Command(j)
	if e != nil {
		return result
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/pvesh", args...)
	var stdout bounded
	cmd.Stdout = &stdout
	cmd.Stderr = io.Discard
	if e = cmd.Run(); e != nil {
		return result
	}
	if stdout.Len() > 0 {
		if e = json.Unmarshal(stdout.Bytes(), &result.Data); e != nil {
			return result
		}
	}
	result.OK = true
	return result
}
func Run(ctx context.Context, path string) error {
	b, e := os.ReadFile(path)
	if e != nil {
		return errors.New("enroll the Proxmox agent first")
	}
	var cfg Config
	if json.Unmarshal(b, &cfg) != nil || !validServer(cfg.Server) || cfg.Token == "" {
		return errors.New("invalid enrollment")
	}
	machine, err := os.ReadFile("/etc/machine-id")
	if err != nil {
		return errors.New("host identity unavailable")
	}
	hash := sha256.Sum256(bytes.TrimSpace(machine))
	if cfg.Hardware != hex.EncodeToString(hash[:]) {
		return errors.New("enrollment belongs to another host")
	}
	c := client(cfg)
	return runLoop(ctx, path, c, execute)
}

func runLoop(ctx context.Context, path string, c *Client, run func(context.Context, Job) Result) error {
	var e error
	journalPath := filepath.Join(filepath.Dir(path), "request.json")
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			_ = c.api(ctx, "POST", "/heartbeat", nil, nil)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	for ctx.Err() == nil {
		// A durable pending receipt becomes an unknown result after a restart. It is
		// delivered without running the command again, including after power actions.
		if b, e := os.ReadFile(journalPath); e == nil {
			var j Journal
			if json.Unmarshal(b, &j) != nil {
				return errors.New("invalid request journal; manual reconciliation required")
			}
			if e = c.api(ctx, "POST", "/result", j.Result, nil); e != nil {
				if !pause(ctx) {
					break
				}
				continue
			}
			if e = os.Remove(journalPath); e != nil {
				return e
			}
		} else if !os.IsNotExist(e) {
			return e
		}
		var job *Job
		if e = c.api(ctx, "GET", "/next", nil, &job); e != nil {
			if !pause(ctx) {
				break
			}
			continue
		}
		if job == nil {
			continue
		}
		journal := Journal{Job: *job, Result: Result{ID: job.ID, Lease: job.Lease, OK: false}}
		if e = writeJSON(journalPath, journal); e != nil {
			return errors.New("cannot persist request receipt; refusing execution")
		}
		if job.Method == "POST" && job.Path == "/speck/console" {
			journal.Result = c.startConsole(ctx, *job)
		} else {
			journal.Result = run(ctx, *job)
		}
		if e = writeJSON(journalPath, journal); e != nil {
			return errors.New("cannot persist result; manual reconciliation required")
		}
	}
	return nil
}
func pause(ctx context.Context) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(5 * time.Second):
		return true
	}
}

// enrichInventory reads only identity/capability fields from the cluster filesystem.
// It never returns passwords, cloud-init data, SSH keys or arbitrary VM config.
func enrichInventory(data any, root string) {
	rows, ok := data.([]any)
	if !ok {
		return
	}
	nodePattern := regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	uuidPattern := regexp.MustCompile(`(?i)(?:^|,)uuid=([0-9a-f-]{36})(?:,|$)`)
	macPattern := regexp.MustCompile(`(?i)([0-9a-f]{2}:){5}[0-9a-f]{2}`)
	for _, value := range rows {
		row, ok := value.(map[string]any)
		if !ok {
			continue
		}
		kind, _ := row["type"].(string)
		node, _ := row["node"].(string)
		id, ok := row["vmid"].(float64)
		if !ok || !nodePattern.MatchString(node) || id < 100 || id != float64(int64(id)) || (kind != "qemu" && kind != "lxc") {
			continue
		}
		directory := "qemu-server"
		if kind == "lxc" {
			directory = "lxc"
		}
		path := filepath.Join(root, node, directory, strconv.FormatInt(int64(id), 10)+".conf")
		content, e := os.ReadFile(path)
		if e != nil || len(content) > 1<<20 {
			row["identity_available"] = false
			continue
		}
		identity := map[string]any{"macs": []string{}, "uuid": "", "guest_agent": false}
		macs := []string{}
		for _, line := range strings.Split(string(content), "\n") {
			if strings.HasPrefix(line, "[") {
				break
			} // Ignore historical snapshot sections.
			key, val, found := strings.Cut(line, ":")
			if !found {
				continue
			}
			val = strings.TrimSpace(val)
			if key == "smbios1" {
				if m := uuidPattern.FindStringSubmatch(val); m != nil {
					identity["uuid"] = m[1]
				}
			}
			if key == "agent" {
				identity["guest_agent"] = val == "1" || strings.HasPrefix(val, "1,") || strings.Contains(val, "enabled=1")
			}
			if regexp.MustCompile(`^net[0-9]+$`).MatchString(key) {
				macs = append(macs, macPattern.FindAllString(val, -1)...)
			}
		}
		identity["macs"] = macs
		row["speck_identity"] = identity
		row["identity_available"] = true
	}
}
