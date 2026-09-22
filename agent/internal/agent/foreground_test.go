package agent

import (
	"path/filepath"
	"testing"
	"time"
)

func TestForegroundSeparatesCurrentHistoricalAndSignedInSessions(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().Truncate(time.Second)
	sessions := []DesktopSession{{User: "EXAMPLE\\Pat", Session: "1", State: "active"}}
	app := map[string]any{"user": "EXAMPLE\\Pat", "session": 1, "title": "Example chart", "process": "chart.exe", "observed_at": now.Format(time.RFC3339)}
	file := filepath.Join(dir, "session-1.json")
	statusFile := filepath.Join(dir, "session-1.desktop-status")
	if err := writeJSON(file, app, 0600); err != nil {
		t.Fatal(err)
	}
	writeJSON(statusFile, PreviewStatus{"active", now.Unix()}, 0600)
	current, last, desktop := foregroundState(dir, now, sessions)
	if current == nil || last == nil || !desktop {
		t.Fatal("active desktop/app missing")
	}
	// Lock/disconnect updates the status independently of the retained app file.
	writeJSON(statusFile, PreviewStatus{"no_desktop", now.Unix()}, 0600)
	current, last, desktop = foregroundState(dir, now, sessions)
	if current != nil || last == nil || desktop {
		t.Fatal("locked/disconnected app was presented as current")
	}
	writeJSON(statusFile, PreviewStatus{"active", now.Unix()}, 0600)
	current, last, desktop = foregroundState(dir, now.Add(time.Minute), sessions)
	if current != nil || last == nil || desktop {
		t.Fatal("stale helper was presented as active")
	}
	// A forged future timestamp must not win newest-observation selection.
	app["observed_at"] = now.Add(time.Hour).Format(time.RFC3339)
	writeJSON(file, app, 0600)
	current, last, _ = foregroundState(dir, now, sessions)
	if current != nil || last != nil {
		t.Fatal("future observation accepted")
	}
}

func TestDesktopAvailableWithoutForegroundWindow(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	writeJSON(filepath.Join(dir, "session-1.desktop-status"), PreviewStatus{"active", now.Unix()}, 0600)
	current, last, desktop := foregroundState(dir, now, []DesktopSession{{User: "Pat", Session: "1", State: "active"}})
	if current != nil || last != nil || !desktop {
		t.Fatal("desktop availability incorrectly depends on a foreground app")
	}
}
