import SwiftUI

struct AccountView: View {
  @Environment(SpeckSession.self) private var session
  @State private var details: JSON = .null
  @State private var signOut = false
  @State private var revoke = false
  @State private var message: String?
  @State private var error: String?
  var body: some View {
    List {
      Section {
        HStack(spacing: 16) {
          Text(session.username.prefix(1).uppercased()).font(.title2.weight(.semibold)).frame(
            width: 54, height: 54
          ).background(Color.lime, in: Circle()).foregroundStyle(Color.forest)
          VStack(alignment: .leading, spacing: 5) {
            Text(session.username).font(.headline)
            Text(titleCase(session.role)).font(.subheadline).foregroundStyle(.secondary)
          }
        }.padding(.vertical, 8)
        LabeledContent("Server", value: session.server).font(.subheadline).textSelection(.enabled)
      }
      Section {
        LabeledContent(
          "Two-factor authentication",
          value: details.isNull
            ? "Loading…" : details["mfa_enabled"].bool ? "Enabled" : "Not enabled")
        LabeledContent(
          "Active sessions",
          value: details.isNull ? "Loading…" : "\(Int(details["sessions"].number))")
        Button("Revoke other sessions", role: .destructive) { revoke = true }.disabled(session.demo)
      } header: {
        Text("Access")
      } footer: {
        Text("Manage authenticator setup and account access in the web console.")
      }
      if let message {
        Label(message, systemImage: "checkmark.circle").foregroundStyle(Color.speckTint)
      }
      if let error { InlineError(text: error) }
      Section("Speck") {
        VStack(alignment: .leading, spacing: 14) {
          SpeckWordmark()
          Text("A LITTLE LIGHTWEIGHT RMM").font(.caption2.weight(.bold)).tracking(1.5)
            .foregroundStyle(.secondary)
        }.padding(.vertical, 12)
        LabeledContent(
          "Version",
          value:
            "\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0") (\(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"))"
        )
        Link(destination: URL(string: "https://github.com/amcchord/speck")!) {
          Label("Source code & support", systemImage: "arrow.up.right.square")
        }
        NavigationLink {
          PrivacyView()
        } label: {
          Label("Privacy", systemImage: "hand.raised")
        }
      }
      Section { Button("Sign out", role: .destructive) { signOut = true } }
    }.navigationTitle("Account").scrollContentBackground(.hidden).background(Color.paper)
      .task { await load() }.refreshable { await load() }
      .confirmationDialog("Sign out of Speck?", isPresented: $signOut, titleVisibility: .visible) {
        Button("Sign out", role: .destructive) { Task { await session.signOut() } }
      } message: {
        Text("Your current remote sessions will close.")
      }
      .alert("Revoke other sessions?", isPresented: $revoke) {
        Button("Cancel", role: .cancel) {}
        Button("Revoke", role: .destructive) {
          Task {
            do {
              let result = try await session.request("/access/sessions/revoke", method: "POST")
              message = "Revoked \(Int(result["revoked"].number)) sessions."
              await load()
            } catch { self.error = error.localizedDescription }
          }
        }
      } message: {
        Text("Other browsers and apps will need to sign in again. Remote sessions will close.")
      }
  }
  func load() async {
    do {
      details = try await session.request("/access/me")
      error = nil
    } catch { self.error = error.localizedDescription }
  }
}
struct PrivacyView: View {
  var body: some View {
    List {
      Section("Your server, your fleet") {
        Text(
          "Speck connects to the server you choose. Machine inventory, alerts, commands, file transfers and recovery records are processed by that server under your account’s permissions."
        )
      }
      Section("On this device") {
        Text(
          "Your session token is stored in the device-only Keychain. Your password is never saved by Speck. Machine data stays in memory. Downloaded files are temporary until you choose to save or share them. Screens are hidden in the app switcher."
        )
      }
      Section("Optional features") {
        Text(
          "AI drafting sends the prompt you submit to your server’s configured OpenAI account. Remote microphone access asks for permission and starts only when you enable it. Speck includes no advertising or tracking SDKs."
        )
      }
    }.navigationTitle("Privacy").navigationBarTitleDisplayMode(.inline)
  }
}
