//go:build windows

package agent

import (
	"fmt"
	"golang.org/x/sys/windows"
	"io"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestInteractivePowerShellConPTY(t *testing.T) {
	if remoteCapabilities()["web_shell"] != true {
		t.Fatal("This validation requires ConPTY")
	}
	t.Setenv("SPECK_PRIVATE_TEST", "must-not-inherit")
	term, err := startPowerShell(100, 30)
	if err != nil {
		t.Fatal(err)
	}
	defer term.Close()
	chunks := make(chan string, 1000)
	go func() {
		defer close(chunks)
		b := make([]byte, 16384)
		for {
			n, e := term.output.Read(b)
			if n > 0 {
				chunks <- string(b[:n])
			}
			if e != nil {
				return
			}
		}
	}()
	ansi := regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)`)
	pending := ""
	readMatching := func(pattern *regexp.Regexp) string {
		t.Helper()
		timer := time.NewTimer(25 * time.Second)
		defer timer.Stop()
		for {
			plain := ansi.ReplaceAllString(pending, "")
			if loc := pattern.FindStringIndex(plain); loc != nil {
				match := plain[loc[0]:loc[1]]
				pending = plain[loc[1]:]
				return match
			}
			select {
			case s, ok := <-chunks:
				if !ok {
					t.Fatalf("EOF waiting for %s: %q", pattern, pending)
				}
				pending += s
			case <-timer.C:
				t.Fatalf("timeout waiting for %s: %q", pattern, pending)
			}
		}
	}
	readUntil := func(want string) string { return readMatching(regexp.MustCompile(regexp.QuoteMeta(want))) }
	write := func(s string) {
		t.Helper()
		if _, e := io.WriteString(term.input, s); e != nil {
			t.Fatal(e)
		}
	}
	readUntil("PS ")
	// Split proof strings so echoing the command cannot satisfy the assertion.
	write("$speckState=41; Write-Output ('state-'+($speckState+1))\r")
	readUntil("state-42")
	write("Write-Output ('persist-'+$speckState); Write-Output ('unicode-'+[char]0x00e9+[char]0x6f22); Write-Output ('private-'+[string]::IsNullOrEmpty($env:SPECK_PRIVATE_TEST)); Write-Output ('history-'+(Get-PSReadLineOption).HistorySaveStyle)\r")
	readUntil("persist-41")
	readUntil("unicode-é漢")
	readUntil("private-True")
	readUntil("history-SaveNothing")
	if err := term.Resize(132, 43); err != nil {
		t.Fatal(err)
	}
	write("Write-Output ('size-'+$Host.UI.RawUI.WindowSize.Width+'x'+$Host.UI.RawUI.WindowSize.Height)\r")
	readUntil("size-132x43")
	write("Start-Sleep -Seconds 45\r")
	readUntil("45")
	time.Sleep(300 * time.Millisecond)
	write("\x03")
	readUntil("PS ")
	write("Write-Output ('interrupt-'+'ok')\r")
	readUntil("interrupt-ok")
	// A foreground child must be killed with the session, not left running.
	write("$p=Start-Process -FilePath $env:COMSPEC -ArgumentList '/c ping -n 120 127.0.0.1 >NUL' -PassThru -WindowStyle Hidden; Write-Output ('child-id-'+$p.Id)\r")
	out := readMatching(regexp.MustCompile(`child-id-\d+[\r\n]`))
	var pid uint32
	fmt.Sscanf(strings.TrimSpace(out), "child-id-%d", &pid)
	child, e := windows.OpenProcess(windows.SYNCHRONIZE, false, pid)
	if e != nil {
		t.Fatal(e)
	}
	defer windows.CloseHandle(child)
	done := make(chan struct{})
	go func() { term.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("terminal close blocked")
	}
	state, e := windows.WaitForSingleObject(child, 3000)
	if e != nil || state != windows.WAIT_OBJECT_0 {
		t.Fatalf("child survived session: %v %v", state, e)
	}
	if term.Resize(100, 30) == nil {
		t.Fatal("closed terminal accepted resize")
	}
}
