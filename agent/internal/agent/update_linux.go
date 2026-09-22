//go:build linux

package agent

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

func protectUpdateDir(path string) error { return os.Chmod(path, 0700) }
func launchUpdate(helper, config string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "systemd-run", "--quiet", "--collect", "--unit=SpeckAgentUpdate-"+filepath.Base(filepath.Dir(helper)), helper, "--config", config, "apply-update").Run()
}
func controlUpdateService(parent context.Context, action string) error {
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()
	return exec.CommandContext(ctx, "systemctl", action, "SpeckAgent").Run()
}

// Existing desktop observers keep their current session and pick up the new
// binary at the next sign-in. The privileged service itself updates immediately.
func stopUpdateHelpers(string) error { return nil }
func refreshUpdateHelpers(string)    {}

func finalizeUpdateFiles(install string) error {
	return os.Chmod(filepath.Join(install, "speck-agent"), 0755)
}
