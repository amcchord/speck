//go:build windows

package agent

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

func TestUpdateWaitsForWindowsImageLock(t *testing.T) {
	for _, release := range []bool{true, false} {
		dir := t.TempDir()
		source, target := filepath.Join(dir, "candidate"), filepath.Join(dir, "installed")
		if err := os.WriteFile(source, []byte("new"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte("old"), 0600); err != nil {
			t.Fatal(err)
		}
		name, _ := windows.UTF16PtrFromString(target)
		handle, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
		if err != nil {
			t.Fatal(err)
		}
		closed := make(chan struct{})
		if release {
			go func() { time.Sleep(200 * time.Millisecond); windows.CloseHandle(handle); close(closed) }()
		}
		ctx, cancel := context.WithTimeout(context.Background(), 600*time.Millisecond)
		err = replaceUpdateFile(ctx, source, target)
		cancel()
		if release {
			<-closed
		} else {
			windows.CloseHandle(handle)
		}
		if (err == nil) != release {
			t.Fatalf("released=%v: %v", release, err)
		}
		data, err := os.ReadFile(target)
		if err != nil {
			t.Fatal(err)
		}
		want := "old"
		if release {
			want = "new"
		}
		if string(data) != want {
			t.Fatalf("installed %q, want %q", data, want)
		}
		if !release {
			data, err = os.ReadFile(source)
			if err != nil || string(data) != "new" {
				t.Fatal("lost candidate during locked replacement", err)
			}
		}
	}
}
