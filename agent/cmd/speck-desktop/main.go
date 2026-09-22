//go:build windows

// Speck's unprivileged session observer has no console window.
package main

import (
	"github.com/amcchord/speck/agent/internal/agent"
	"path/filepath"
	"time"
)

func main() {
	tick := 0
	for {
		if tick%5 == 0 {
			agent.WritePreview(filepath.Join(filepath.Dir(agent.DefaultConfig()), "telemetry"))
		}
		tick++
		agent.WriteForeground(filepath.Join(filepath.Dir(agent.DefaultConfig()), "telemetry"))
		time.Sleep(2 * time.Second)
	}
}
