package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/amcchord/speck/agent/internal/proxmox"
	"os"
	"os/signal"
	"runtime"
	"syscall"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "version" {
		fmt.Println("Speck Proxmox Agent " + proxmox.Version)
		return
	}
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Run as root on a Proxmox host")
		os.Exit(1)
	}
	var err error
	if len(os.Args) > 1 && os.Args[1] == "enroll" {
		var input struct {
			Server string `json:"server"`
			Token  string `json:"token"`
		}
		err = json.NewDecoder(os.Stdin).Decode(&input)
		if err == nil {
			err = proxmox.Enroll(proxmox.DefaultConfig, input.Server, input.Token)
		}
	} else {
		ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
		defer cancel()
		err = proxmox.Run(ctx, proxmox.DefaultConfig)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
