package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/amcchord/speck/agent/internal/agent"
	"github.com/kardianos/service"
)

type program struct {
	cancel context.CancelFunc
	config string
}

func (p *program) Start(s service.Service) error {
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	go func() {
		if err := agent.Run(ctx, p.config); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}()
	return nil
}
func (p *program) Stop(s service.Service) error {
	if p.cancel != nil {
		p.cancel()
	}
	return nil
}
func main() {
	config := agent.DefaultConfig()
	args := os.Args[1:]
	if len(args) > 1 && args[0] == "--config" {
		config = args[1]
		args = args[2:]
	}
	mode := "run"
	if len(args) > 0 {
		mode = args[0]
	}
	switch mode {
	case "enroll":
		var input struct {
			Server string `json:"server"`
			Token  string `json:"token"`
		}
		if err := json.NewDecoder(bufio.NewReader(os.Stdin)).Decode(&input); err != nil {
			fatal(err)
		}
		if err := agent.Enroll(config, input.Server, input.Token); err != nil {
			fatal(err)
		}
		fmt.Println("Speck enrollment complete")
	case "foreground":
		dir := filepath.Join(filepath.Dir(config), "telemetry")
		for {
			agent.WriteForeground(dir)
			time.Sleep(2 * time.Second)
		}
	case "version":
		fmt.Println(agent.Version, runtime.GOOS, runtime.GOARCH)
	default:
		p := &program{config: config}
		svc, err := service.New(p, &service.Config{Name: "SpeckAgent", DisplayName: "Speck Agent", Description: "Speck remote monitoring and recovery management", Arguments: []string{"--config", config, "run"}, Option: service.KeyValue{"Restart": "on-failure", "RestartSec": 5, "StartType": "automatic", "DelayedAutoStart": true, "OnFailure": "restart", "OnFailureDelayDuration": "10s", "OnFailureResetPeriod": 86400}})
		if err != nil {
			fatal(err)
		}
		if mode != "run" {
			if err := service.Control(svc, mode); err != nil {
				fatal(err)
			}
			return
		}
		if err := svc.Run(); err != nil {
			fatal(err)
		}
	}
}
func fatal(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
