package agent

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func signedTestRelease(t *testing.T, manifest UpdateManifest) (UpdateEnvelope, string) {
	t.Helper()
	pub, key, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	payload, _ := json.Marshal(manifest)
	return UpdateEnvelope{base64.StdEncoding.EncodeToString(payload), base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))}, base64.StdEncoding.EncodeToString(pub)
}
func releaseFixture() UpdateManifest {
	now := time.Now().Unix()
	return UpdateManifest{Version: "0.3.1", Platform: "linux", Arch: "amd64", PublishedAt: now, ExpiresAt: now + 86400, Files: []UpdateAsset{{Name: "speck-agent-linux-amd64", Size: 3, SHA256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}}}
}
func TestReleaseVerification(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*UpdateManifest)
		valid  bool
	}{
		{"valid", func(*UpdateManifest) {}, true},
		{"downgrade", func(m *UpdateManifest) { m.Version = "0.2.1" }, false},
		{"same version", func(m *UpdateManifest) { m.Version = "0.3.0" }, false},
		{"invalid version", func(m *UpdateManifest) { m.Version = "../3.1" }, false},
		{"expired", func(m *UpdateManifest) { m.ExpiresAt = time.Now().Unix() - 1 }, false},
		{"future", func(m *UpdateManifest) { m.PublishedAt = time.Now().Unix() + 3600 }, false},
		{"long validity", func(m *UpdateManifest) { m.ExpiresAt = m.PublishedAt + 91*86400 }, false},
		{"wrong OS", func(m *UpdateManifest) { m.Platform = "windows" }, false},
		{"wrong arch", func(m *UpdateManifest) { m.Arch = "arm64" }, false},
		{"path traversal", func(m *UpdateManifest) { m.Files[0].Name = "../../agent.json" }, false},
		{"unbounded size", func(m *UpdateManifest) { m.Files[0].Size = 101 * 1024 * 1024 }, false},
		{"invalid hash", func(m *UpdateManifest) { m.Files[0].SHA256 = "abc" }, false},
		{"missing asset", func(m *UpdateManifest) { m.Files = nil }, false},
		{"extra asset", func(m *UpdateManifest) { m.Files = append(m.Files, m.Files[0]) }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := releaseFixture()
			tc.mutate(&m)
			envelope, key := signedTestRelease(t, m)
			_, e := verifyRelease(envelope, key, "linux", "amd64", "0.3.0", time.Now())
			if (e == nil) != tc.valid {
				t.Fatalf("valid=%v: %v", tc.valid, e)
			}
		})
	}
	envelope, key := signedTestRelease(t, releaseFixture())
	envelope.Payload = base64.StdEncoding.EncodeToString([]byte(`{"version":"99.0.0"}`))
	if _, e := verifyRelease(envelope, key, "linux", "amd64", "0.3.0", time.Now()); e == nil {
		t.Fatal("accepted tampering")
	}
	envelope, _ = signedTestRelease(t, releaseFixture())
	if _, e := verifyRelease(envelope, key, "linux", "amd64", "0.3.0", time.Now()); e == nil {
		t.Fatal("accepted foreign signer")
	}
}
func TestUpdateAssetIntegrity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "asset")
	asset := releaseFixture().Files[0]
	for _, data := range []string{"abc", "ab", "abcd", "xyz"} {
		if e := os.WriteFile(path, []byte(data), 0700); e != nil {
			t.Fatal(e)
		}
		if (verifyAsset(path, asset) == nil) != (data == "abc") {
			t.Fatal("incorrect integrity result", data)
		}
	}
}
func TestStagedUpdateTransaction(t *testing.T) {
	for _, scenario := range []string{"healthy", "no checkin", "wrong checkin", "start failed", "helper failed", "partial replacement"} {
		t.Run(scenario, func(t *testing.T) {
			install := t.TempDir()
			stage := filepath.Join(install, ".speck-update-test")
			if e := os.Mkdir(stage, 0700); e != nil {
				t.Fatal(e)
			}
			config := filepath.Join(install, "agent.json")
			if e := os.WriteFile(config, []byte("identity-must-survive"), 0600); e != nil {
				t.Fatal(e)
			}
			manifest := releaseFixture()
			manifest.Platform = "windows"
			manifest.Files = []UpdateAsset{{Name: "speck-agent-windows-amd64.exe"}, {Name: "speck-desktop-windows-amd64.exe"}}
			names := updateAssetNames("windows", "amd64")
			for _, asset := range manifest.Files {
				os.WriteFile(filepath.Join(install, names[asset.Name]), []byte("old-"+asset.Name), 0700)
				os.WriteFile(filepath.Join(stage, asset.Name), []byte("new-"+asset.Name), 0700)
			}
			if scenario == "partial replacement" {
				os.Remove(filepath.Join(stage, manifest.Files[1].Name))
			}
			calls := []string{}
			starts := 0
			hooks := updateHooks{confirmTimeout: 30 * time.Millisecond, pollInterval: time.Millisecond, finalize: func(string) error { return nil }, refreshHelpers: func(string) {}, stopHelpers: func(string) error {
				if scenario == "helper failed" {
					return errors.New("helper is busy")
				}
				return nil
			}, control: func(_ context.Context, action string) error {
				calls = append(calls, action)
				if action == "start" {
					starts++
					if starts == 1 {
						if scenario == "start failed" {
							return errors.New("service failed")
						}
						if scenario == "healthy" || scenario == "wrong checkin" {
							v := manifest.Version
							if scenario == "wrong checkin" {
								v = "0.1.0"
							}
							writeJSON(filepath.Join(stage, "confirmed.json"), map[string]string{"version": v}, 0600)
						}
					}
				}
				return nil
			}}
			err := installStagedUpdate(context.Background(), config, stage, install, manifest, "0.3.0", hooks)
			if (err == nil) != (scenario == "healthy") {
				t.Fatalf("unexpected result %v", err)
			}
			for _, asset := range manifest.Files {
				data, _ := os.ReadFile(filepath.Join(install, names[asset.Name]))
				prefix := "old-"
				if scenario == "healthy" {
					prefix = "new-"
				}
				if string(data) != prefix+asset.Name {
					t.Fatal("wrong installed bytes", string(data))
				}
				backup, _ := os.ReadFile(filepath.Join(stage, names[asset.Name]+".previous"))
				if string(backup) != "old-"+asset.Name {
					t.Fatal("missing retained backup")
				}
			}
			data, _ := os.ReadFile(config)
			if string(data) != "identity-must-survive" {
				t.Fatal("identity changed")
			}
			want := "failed"
			if scenario == "healthy" {
				want = "current"
				if !reflect.DeepEqual(calls, []string{"stop", "start"}) {
					t.Fatal(calls)
				}
			}
			if updateState(config).Status != want {
				t.Fatal(updateState(config))
			}
		})
	}
}
