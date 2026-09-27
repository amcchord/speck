//go:build windows

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
	"unsafe"

	"github.com/gorilla/websocket"
	"golang.org/x/sys/windows"
)

func remoteCapabilities() map[string]any {
	available := windows.NewLazySystemDLL("kernel32.dll").NewProc("CreatePseudoConsole").Find() == nil
	return map[string]any{"web_shell": available, "shell": "powershell", "desktop": "unknown"}
}

type windowsTerminal struct {
	input, output *os.File
	console, job  windows.Handle
	done          chan struct{}
	once          sync.Once
	mu            sync.Mutex
	closed        bool
}

func consoleSize(cols, rows int) windows.Coord {
	return windows.Coord{X: int16(max(2, min(500, cols))), Y: int16(max(1, min(200, rows)))}
}
func (t *windowsTerminal) Resize(cols, rows int) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return io.ErrClosedPipe
	}
	return windows.ResizePseudoConsole(t.console, consoleSize(cols, rows))
}
func (t *windowsTerminal) Close() {
	t.once.Do(func() {
		t.mu.Lock()
		t.closed = true
		t.mu.Unlock()
		// A job object contains the shell and every child; closing a browser never
		// leaves a foreground process running under Local System.
		_ = windows.TerminateJobObject(t.job, 1)
		_ = t.input.Close()
		// ClosePseudoConsole can emit a final frame and block until it is drained.
		// Keep a reader alive even if the websocket writer has already failed.
		drained := make(chan struct{})
		go func() { _, _ = io.Copy(io.Discard, t.output); close(drained) }()
		windows.ClosePseudoConsole(t.console)
		_ = t.output.Close()
		<-drained
		<-t.done
		_ = windows.CloseHandle(t.job)
	})
}

func startPowerShell(cols, rows int) (_ *windowsTerminal, err error) {
	if remoteCapabilities()["web_shell"] != true {
		return nil, errors.New("Windows pseudoconsole requires Windows 10 1809 / Server 2019 or later")
	}
	inputR, inputW, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	defer inputR.Close()
	outputR, outputW, err := os.Pipe()
	if err != nil {
		inputW.Close()
		return nil, err
	}
	defer outputW.Close()
	t := &windowsTerminal{input: inputW, output: outputR, done: make(chan struct{})}
	success := false
	defer func() {
		if !success {
			inputW.Close()
			// Drain failed startup too: ClosePseudoConsole can write a final frame.
			if t.console != 0 {
				go io.Copy(io.Discard, outputR)
				windows.ClosePseudoConsole(t.console)
			}
			outputR.Close()
			if t.job != 0 {
				windows.CloseHandle(t.job)
			}
		}
	}()
	if err = windows.CreatePseudoConsole(consoleSize(cols, rows), windows.Handle(inputR.Fd()), windows.Handle(outputW.Fd()), 0, &t.console); err != nil {
		return nil, err
	}
	attrs, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		return nil, err
	}
	defer attrs.Delete()
	// The native API takes the HPCON value here, not a pointer to that value.
	if err = attrs.Update(windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, unsafe.Pointer(t.console), unsafe.Sizeof(t.console)); err != nil {
		return nil, err
	}
	t.job, err = windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, err
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(t.job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		return nil, err
	}
	system, err := windows.GetSystemDirectory()
	if err != nil {
		return nil, err
	}
	exe := filepath.Join(system, "WindowsPowerShell", "v1.0", "powershell.exe")
	app, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return nil, err
	}
	// Keep in-session editing/history, but never persist terminal contents through
	// PSReadLine. No profile or agent-service environment is inherited.
	init := `Import-Module PSReadLine -ErrorAction SilentlyContinue; if (Get-Module PSReadLine) { Set-PSReadLineOption -HistorySaveStyle SaveNothing }; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Clear-Host`
	line, err := windows.UTF16PtrFromString(windows.ComposeCommandLine([]string{exe, "-NoLogo", "-NoProfile", "-NoExit", "-Command", init}))
	if err != nil {
		return nil, err
	}
	home, _ := os.UserHomeDir()
	if home == "" {
		home = filepath.Join(system, "config", "systemprofile")
	}
	cwd, err := windows.UTF16PtrFromString(home)
	if err != nil {
		return nil, err
	}
	winDir := filepath.Dir(system)
	env := []string{"APPDATA=" + filepath.Join(home, "AppData", "Roaming"), "COMSPEC=" + filepath.Join(system, "cmd.exe"), "LOCALAPPDATA=" + filepath.Join(home, "AppData", "Local"), "PATH=" + system + ";" + winDir + ";" + filepath.Dir(exe), "PSModulePath=" + filepath.Join(filepath.Dir(exe), "Modules"), "SystemRoot=" + winDir, "TEMP=" + os.TempDir(), "TERM=xterm-256color", "TMP=" + os.TempDir(), "USERPROFILE=" + home, "windir=" + winDir}
	environment := utf16.Encode([]rune(strings.Join(env, "\x00") + "\x00\x00"))
	// Explicit null standard handles prevent redirected service output from
	// leaking outside the pseudoconsole (microsoft/terminal discussion 15814).
	si := windows.StartupInfoEx{StartupInfo: windows.StartupInfo{Flags: windows.STARTF_USESTDHANDLES, Cb: uint32(unsafe.Sizeof(windows.StartupInfoEx{}))}, ProcThreadAttributeList: attrs.List()}
	var process windows.ProcessInformation
	err = windows.CreateProcess(app, line, nil, nil, false, windows.CREATE_UNICODE_ENVIRONMENT|windows.EXTENDED_STARTUPINFO_PRESENT|windows.CREATE_SUSPENDED, &environment[0], cwd, &si.StartupInfo, &process)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(process.Thread)
	if err = windows.AssignProcessToJobObject(t.job, process.Process); err != nil {
		windows.TerminateProcess(process.Process, 1)
		windows.CloseHandle(process.Process)
		return nil, err
	}
	if _, err = windows.ResumeThread(process.Thread); err != nil {
		windows.TerminateJobObject(t.job, 1)
		windows.CloseHandle(process.Process)
		return nil, err
	}
	go func() {
		_, _ = windows.WaitForSingleObject(process.Process, windows.INFINITE)
		windows.CloseHandle(process.Process)
		close(t.done)
	}()
	success = true
	return t, nil
}

func (c *Client) shell(ctx context.Context, p map[string]any) (map[string]any, error) {
	address := "wss" + strings.TrimPrefix(c.Config.Server, "https") + "/api/agent/tunnels/" + url.PathEscape(text(p, "session_id"))
	header := http.Header{"Authorization": {"Bearer " + c.Config.Token}, "X-Speck-Hardware": {c.Hardware}, "X-Speck-Tunnel-Secret": {text(p, "secret")}}
	ws, _, err := websocket.DefaultDialer.DialContext(ctx, address, header)
	if err != nil {
		return nil, errors.New("interactive terminal connection failed")
	}
	defer ws.Close()
	ws.SetReadLimit(65536)
	terminal, err := startPowerShell(number(p, "cols", 100), number(p, "rows", 30))
	if err != nil {
		return nil, errors.New("could not start interactive PowerShell")
	}
	defer terminal.Close()
	if err = ws.WriteJSON(map[string]any{"type": "ready"}); err != nil {
		return nil, err
	}
	var workers sync.WaitGroup
	workers.Add(2)
	defer func() { ws.Close(); terminal.Close(); workers.Wait() }()
	errs := make(chan error, 2)
	go func() {
		defer workers.Done()
		buffer := make([]byte, 16384)
		for {
			n, e := terminal.output.Read(buffer)
			if n > 0 {
				ws.SetWriteDeadline(time.Now().Add(30 * time.Second))
				if writeErr := ws.WriteMessage(websocket.BinaryMessage, buffer[:n]); writeErr != nil {
					errs <- writeErr
					return
				}
			}
			if e != nil {
				errs <- e
				return
			}
		}
	}()
	go func() {
		defer workers.Done()
		for {
			kind, value, e := ws.ReadMessage()
			if e != nil {
				errs <- e
				return
			}
			if kind != websocket.TextMessage {
				errs <- errors.New("invalid terminal input")
				return
			}
			var input struct {
				Type string `json:"type"`
				Data string `json:"data"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if e = json.Unmarshal(value, &input); e != nil {
				errs <- e
				return
			}
			switch input.Type {
			case "input":
				_, e = terminal.input.Write([]byte(input.Data))
			case "resize":
				e = terminal.Resize(input.Cols, input.Rows)
			default:
				e = errors.New("invalid terminal input")
			}
			if e != nil {
				errs <- e
				return
			}
		}
	}()
	select {
	case <-ctx.Done():
	case <-terminal.done:
	case <-errs:
	}
	return map[string]any{"session": "ended"}, nil
}
