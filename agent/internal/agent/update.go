package agent

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type UpdateEnvelope struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}
type UpdateAsset struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type UpdateManifest struct {
	Version     string        `json:"version"`
	Platform    string        `json:"platform"`
	Arch        string        `json:"arch"`
	PublishedAt int64         `json:"published_at"`
	ExpiresAt   int64         `json:"expires_at"`
	Files       []UpdateAsset `json:"files"`
}
type UpdateState struct {
	Version  string `json:"version"`
	Previous string `json:"previous,omitempty"`
	Status   string `json:"status"`
	At       int64  `json:"at"`
	Stage    string `json:"stage,omitempty"`
}
type updatePlan struct {
	Envelope UpdateEnvelope `json:"envelope"`
	Previous string         `json:"previous"`
	Config   string         `json:"config"`
}

var releaseVersion = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

func compareVersion(a, b string) (int, error) {
	if !releaseVersion.MatchString(a) || !releaseVersion.MatchString(b) {
		return 0, errors.New("invalid release version")
	}
	aa, bb := strings.Split(a, "."), strings.Split(b, ".")
	for i := range aa {
		x, e := strconv.ParseUint(aa[i], 10, 32)
		if e != nil {
			return 0, e
		}
		y, e := strconv.ParseUint(bb[i], 10, 32)
		if e != nil {
			return 0, e
		}
		if x > y {
			return 1, nil
		}
		if x < y {
			return -1, nil
		}
	}
	return 0, nil
}
func updateAssetNames(platform, arch string) map[string]string {
	if platform == "linux" && (arch == "amd64" || arch == "arm64") {
		return map[string]string{"speck-agent-linux-" + arch: "speck-agent"}
	}
	if platform == "windows" && arch == "amd64" {
		return map[string]string{"speck-agent-windows-amd64.exe": "speck-agent.exe", "speck-desktop-windows-amd64.exe": "speck-desktop.exe"}
	}
	return nil
}
func verifyRelease(envelope UpdateEnvelope, key, platform, arch, current string, now time.Time) (UpdateManifest, error) {
	var manifest UpdateManifest
	data, e := base64.StdEncoding.DecodeString(envelope.Payload)
	if e != nil || len(data) > 32768 {
		return manifest, errors.New("invalid release payload")
	}
	pub, e := base64.StdEncoding.DecodeString(key)
	if e != nil || len(pub) != ed25519.PublicKeySize {
		return manifest, errors.New("invalid release trust key")
	}
	sig, e := base64.StdEncoding.DecodeString(envelope.Signature)
	if e != nil || !ed25519.Verify(pub, data, sig) {
		return manifest, errors.New("release signature rejected")
	}
	if json.Unmarshal(data, &manifest) != nil {
		return manifest, errors.New("invalid release metadata")
	}
	cmp, e := compareVersion(manifest.Version, current)
	if e != nil || cmp <= 0 {
		return manifest, errors.New("release is not newer")
	}
	if manifest.Platform != platform || manifest.Arch != arch || manifest.PublishedAt > now.Unix()+300 || manifest.ExpiresAt <= now.Unix() || manifest.ExpiresAt-manifest.PublishedAt > 90*86400 {
		return manifest, errors.New("release target or validity rejected")
	}
	expected := updateAssetNames(platform, arch)
	if len(expected) == 0 || len(expected) != len(manifest.Files) {
		return manifest, errors.New("release assets rejected")
	}
	for _, asset := range manifest.Files {
		hash, e := hex.DecodeString(asset.SHA256)
		if expected[asset.Name] == "" || e != nil || len(hash) != 32 || asset.Size < 1 || asset.Size > 100*1024*1024 {
			return manifest, errors.New("release asset rejected")
		}
		delete(expected, asset.Name)
	}
	if len(expected) != 0 {
		return manifest, errors.New("duplicate release asset")
	}
	return manifest, nil
}
func (c *Client) updateKey() string {
	if c.Config.UpdatePublicKey != "" {
		return c.Config.UpdatePublicKey
	}
	return updatePublicKey
}
func updateState(path string) UpdateState {
	var state UpdateState
	if raw, e := os.ReadFile(filepath.Join(filepath.Dir(path), "update-state.json")); e == nil {
		_ = json.Unmarshal(raw, &state)
	}
	return state
}
func saveUpdateState(path string, state UpdateState) error {
	state.At = time.Now().Unix()
	return writeJSON(filepath.Join(filepath.Dir(path), "update-state.json"), state, 0600)
}
func updateTelemetry(path string) map[string]any {
	state := updateState(path)
	status := state.Status
	if status == "" {
		status = "ready"
	}
	return map[string]any{"status": status, "version": state.Version, "updated_at": state.At}
}
func sameInstallStage(stage, binary string) bool {
	return filepath.Dir(stage) == filepath.Dir(binary) && strings.HasPrefix(filepath.Base(stage), ".speck-update-")
}
func (c *Client) confirmUpdate() {
	state := updateState(c.ConfigPath)
	if state.Status != "installing" || state.Version != Version {
		return
	}
	binary, e := os.Executable()
	if e != nil || !sameInstallStage(state.Stage, binary) {
		return
	}
	_ = writeJSON(filepath.Join(state.Stage, "confirmed.json"), map[string]string{"version": Version}, 0600)
}
func copyUpdateFile(from, to string) error {
	input, e := os.Open(from)
	if e != nil {
		return e
	}
	defer input.Close()
	output, e := os.OpenFile(to, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if e != nil {
		return e
	}
	_, e = io.Copy(output, input)
	if e == nil {
		e = output.Sync()
	}
	closeErr := output.Close()
	if e != nil {
		return e
	}
	return closeErr
}
func verifyAsset(path string, asset UpdateAsset) error {
	f, e := os.Open(path)
	if e != nil {
		return e
	}
	defer f.Close()
	h := sha256.New()
	n, e := io.Copy(h, io.LimitReader(f, asset.Size+1))
	if e != nil || n != asset.Size || hex.EncodeToString(h.Sum(nil)) != strings.ToLower(asset.SHA256) {
		return errors.New("agent asset hash or size mismatch")
	}
	return nil
}
func (c *Client) checkUpdate(ctx context.Context) bool {
	if os.Getenv("SPECK_DISABLE_AGENT_UPDATES") == "1" {
		return false
	}
	var offer struct {
		Enabled bool            `json:"enabled"`
		Release *UpdateEnvelope `json:"release"`
	}
	if c.api(ctx, "GET", "/api/agent/update", nil, &offer) != nil || !offer.Enabled || offer.Release == nil {
		return false
	}
	manifest, e := verifyRelease(*offer.Release, c.updateKey(), runtime.GOOS, runtime.GOARCH, Version, time.Now())
	if e != nil {
		return false
	}
	previous := updateState(c.ConfigPath)
	if previous.Version == manifest.Version && (previous.Status == "failed" || previous.Status == "rollback_failed") {
		return false
	}
	binary, e := os.Executable()
	if e != nil {
		return false
	}
	binary, e = filepath.EvalSymlinks(binary)
	if e != nil {
		return false
	}
	targets := updateAssetNames(runtime.GOOS, runtime.GOARCH)
	if filepath.Base(binary) != targets["speck-agent-"+runtime.GOOS+"-"+runtime.GOARCH+exeSuffix()] {
		return false
	}
	stage, e := os.MkdirTemp(filepath.Dir(binary), ".speck-update-")
	if e != nil {
		return false
	}
	launched := false
	defer func() {
		if !launched {
			_ = os.RemoveAll(stage)
		}
	}()
	if protectUpdateDir(stage) != nil {
		return false
	}
	fail := func() bool {
		_ = saveUpdateState(c.ConfigPath, UpdateState{Version: manifest.Version, Previous: Version, Status: "failed"})
		return false
	}
	for _, asset := range manifest.Files {
		// Paths and filenames come only from the verified platform-specific manifest.
		response, e := c.request(ctx, "GET", "/downloads/agent-releases/"+manifest.Version+"/"+asset.Name, nil)
		if e != nil {
			return false
		}
		if response.StatusCode != 200 {
			response.Body.Close()
			return false
		}
		file, e := os.OpenFile(filepath.Join(stage, asset.Name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
		if e != nil {
			response.Body.Close()
			return false
		}
		_, e = io.Copy(file, io.LimitReader(response.Body, asset.Size+1))
		if e == nil {
			e = file.Sync()
		}
		closeErr := file.Close()
		response.Body.Close()
		if e != nil || closeErr != nil {
			return false
		}
		if verifyAsset(filepath.Join(stage, asset.Name), asset) != nil {
			return fail()
		}
	}
	// Finish downloads before asking for an idle lease; jobs queued meanwhile win.
	var claim struct {
		Enabled bool `json:"enabled"`
	}
	if c.api(ctx, "POST", "/api/agent/update/claim", map[string]string{"version": manifest.Version}, &claim) != nil || !claim.Enabled {
		return false
	}
	helper := filepath.Join(stage, "updater"+exeSuffix())
	if copyUpdateFile(binary, helper) != nil {
		return fail()
	}
	plan := updatePlan{Envelope: *offer.Release, Previous: Version, Config: c.ConfigPath}
	if writeJSON(filepath.Join(stage, "plan.json"), plan, 0600) != nil {
		return fail()
	}
	if saveUpdateState(c.ConfigPath, UpdateState{Version: manifest.Version, Previous: Version, Status: "installing", Stage: stage}) != nil {
		return false
	}
	if launchUpdate(helper, c.ConfigPath) != nil {
		return fail()
	}
	launched = true
	return true
}
func exeSuffix() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}

// ApplyAgentUpdate runs in an independent privileged helper, never in the service
// that it stops. All paths and bytes are revalidated before replacing anything.
func ApplyAgentUpdate(config string) (result error) {
	helper, e := os.Executable()
	if e != nil {
		return e
	}
	stage := filepath.Dir(helper)
	install := filepath.Dir(stage)
	if !strings.HasPrefix(filepath.Base(stage), ".speck-update-") {
		return errors.New("invalid update staging directory")
	}
	raw, e := os.ReadFile(filepath.Join(stage, "plan.json"))
	if e != nil {
		return e
	}
	var plan updatePlan
	if json.Unmarshal(raw, &plan) != nil || plan.Config != config {
		return errors.New("invalid update plan")
	}
	defer func() {
		if result != nil {
			state := updateState(config)
			if state.Stage == stage && state.Status == "installing" {
				state.Status = "failed"
				_ = saveUpdateState(config, state)
			}
		}
	}()
	raw, e = os.ReadFile(config)
	if e != nil {
		return e
	}
	var cfg Config
	if json.Unmarshal(raw, &cfg) != nil {
		return errors.New("invalid agent configuration")
	}
	c := newClient(cfg, config)
	manifest, e := verifyRelease(plan.Envelope, c.updateKey(), runtime.GOOS, runtime.GOARCH, plan.Previous, time.Now())
	if e != nil {
		return e
	}
	for _, asset := range manifest.Files {
		if e = verifyAsset(filepath.Join(stage, asset.Name), asset); e != nil {
			return e
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	// A bounded version probe catches wrong/corrupt executables before the stop.
	agentName := "speck-agent-" + runtime.GOOS + "-" + runtime.GOARCH + exeSuffix()
	probeCtx, probeCancel := context.WithTimeout(ctx, 5*time.Second)
	probe := exec.CommandContext(probeCtx, filepath.Join(stage, agentName), "update-version")
	quiet(probe)
	version, probeErr := probe.Output()
	probeCancel()
	if probeErr != nil || strings.TrimSpace(string(version)) != manifest.Version {
		_ = saveUpdateState(config, UpdateState{Version: manifest.Version, Previous: plan.Previous, Status: "failed"})
		return errors.New("new agent version probe failed")
	}
	return installStagedUpdate(ctx, config, stage, install, manifest, plan.Previous, updateHooks{
		control: controlUpdateService, stopHelpers: stopUpdateHelpers, refreshHelpers: refreshUpdateHelpers, finalize: finalizeUpdateFiles,
		confirmTimeout: 90 * time.Second, pollInterval: time.Second,
	})
}

type updateHooks struct {
	finalize       func(string) error
	control        func(context.Context, string) error
	stopHelpers    func(string) error
	refreshHelpers func(string)
	confirmTimeout time.Duration
	pollInterval   time.Duration
}

func installStagedUpdate(ctx context.Context, config, stage, install string, manifest UpdateManifest, previous string, hooks updateHooks) (result error) {
	names := updateAssetNames(manifest.Platform, manifest.Arch)
	// Keep the backups even after rollback, for operator recovery.
	for _, asset := range manifest.Files {
		if e := copyUpdateFile(filepath.Join(install, names[asset.Name]), filepath.Join(stage, names[asset.Name]+".previous")); e != nil {
			return e
		}
	}
	transitionStarted := false
	replaced := false
	committed := false
	defer func() {
		if committed {
			return
		}
		rollbackCtx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		var recovery error
		if replaced {
			recovery = hooks.control(rollbackCtx, "stop")
			if recovery == nil {
				recovery = hooks.stopHelpers(install)
			}
			if recovery == nil {
				for _, asset := range manifest.Files {
					target := filepath.Join(install, names[asset.Name])
					backup := filepath.Join(stage, names[asset.Name]+".previous")
					restore := filepath.Join(stage, names[asset.Name]+".restore")
					err := copyUpdateFile(backup, restore)
					if err == nil {
						err = replaceFile(restore, target)
					}
					recovery = errors.Join(recovery, err)
				}
			}
		}
		if replaced && recovery == nil {
			recovery = hooks.finalize(install)
		}
		status := "failed"
		if recovery != nil {
			status = "rollback_failed"
		}
		result = errors.Join(result, recovery, saveUpdateState(config, UpdateState{Version: manifest.Version, Previous: previous, Status: status, Stage: stage}))
		if transitionStarted {
			result = errors.Join(result, hooks.control(rollbackCtx, "start"))
			hooks.refreshHelpers(install)
		}
	}()
	transitionStarted = true
	if e := hooks.control(ctx, "stop"); e != nil {
		return e
	}
	if e := hooks.stopHelpers(install); e != nil {
		return e
	}
	for _, asset := range manifest.Files {
		if e := replaceFile(filepath.Join(stage, asset.Name), filepath.Join(install, names[asset.Name])); e != nil {
			return e
		}
		replaced = true
	}
	if e := hooks.finalize(install); e != nil {
		return e
	}
	if e := hooks.control(ctx, "start"); e != nil {
		return e
	}
	deadline := time.NewTimer(hooks.confirmTimeout)
	defer deadline.Stop()
	for {
		raw, _ := os.ReadFile(filepath.Join(stage, "confirmed.json"))
		var confirmation map[string]string
		if json.Unmarshal(raw, &confirmation) == nil && confirmation["version"] == manifest.Version {
			if e := saveUpdateState(config, UpdateState{Version: manifest.Version, Previous: previous, Status: "current", Stage: stage}); e != nil {
				return e
			}
			committed = true
			hooks.refreshHelpers(install)
			return nil
		}
		select {
		case <-deadline.C:
			return errors.New("new agent did not check in")
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(hooks.pollInterval):
		}
	}
}
