//go:build windows

// Speck's unprivileged session observer has no console window.
package main

import (
	"github.com/amcchord/speck/agent/internal/agent"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) == 3 && os.Args[1] == "capture-preview" {
		agent.WritePreview(os.Args[2])
		return
	}
	agent.RunObserver(filepath.Join(filepath.Dir(agent.DefaultConfig()), "telemetry"))
}
