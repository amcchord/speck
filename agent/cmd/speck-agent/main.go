package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/amcchord/speck/agent/internal/agent"
	"github.com/amcchord/speck/agent/internal/identity"
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
	case "apply-update":
		if err := agent.ApplyAgentUpdate(config); err != nil {
			fatal(err)
		}
	case "update-version":
		fmt.Println(agent.Version)
	case "help", "--help", "-h":
		fmt.Printf("%s %s\n%s\n\n", identity.Agent, agent.Version, identity.Tagline)
		fmt.Println("Usage: speck-agent [--config path] <command>")
		fmt.Println("\n  run          Run the agent service")
		fmt.Println("  enroll       Enroll from JSON on standard input")
		fmt.Println("  install      Register the system service")
		fmt.Println("  start        Start the service")
		fmt.Println("  stop         Stop the service")
		fmt.Println("  restart      Restart the service")
		fmt.Println("  uninstall    Remove the service registration")
		fmt.Println("  foreground   Report the active desktop application")
		fmt.Println("  version      Show version and platform")
		fmt.Println("\nhttps://speckrmm.com")
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
		fmt.Println(identity.Agent + ": enrolled.")
	case "capture-preview":
		if len(args) == 2 {
			agent.WritePreview(args[1])
		}
	case "foreground":
		agent.RunObserver(filepath.Join(filepath.Dir(config), "telemetry"))
	case "version", "--version":
		fmt.Printf("%s %s (%s/%s)\n", identity.Agent, agent.Version, runtime.GOOS, runtime.GOARCH)
	default:
		p := &program{config: config}
		svc, err := service.New(p, &service.Config{Name: "SpeckAgent", DisplayName: identity.Agent, Description: identity.Tagline + ". " + identity.Description, Arguments: []string{"--config", config, "run"}, Option: service.KeyValue{"Restart": "on-failure", "RestartSec": 5, "StartType": "automatic", "DelayedAutoStart": true, "OnFailure": "restart", "OnFailureDelayDuration": "10s", "OnFailureResetPeriod": 86400}})
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
func fatal(err error) { fmt.Fprintln(os.Stderr, identity.Agent+":", err); os.Exit(1) }
