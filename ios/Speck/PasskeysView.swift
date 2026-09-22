import SwiftUI

struct PasskeysView: View {
  @Environment(SpeckSession.self) private var session
  @State private var keys: [JSON] = []
  @State private var operation: String?
  @State private var selected: JSON = .null
  @State private var name = ""
  @State private var password = ""
  @State private var code = ""
  @State private var busy = false
  @State private var error: String?
  @State private var message: String?
  @State private var showingSheet = false
  var body: some View {
    List {
      Section {
        ForEach(Array(keys.enumerated()), id: \.offset) { _, key in
          VStack(alignment: .leading, spacing: 8) {
            Text(key["name"].string).font(.headline)
            if key["last_used"].number > 0 {
              Text("Last used \(Date(timeIntervalSince1970: key["last_used"].number).formatted())")
                .font(.caption).foregroundStyle(.secondary)
            } else { Text("Not used yet").font(.caption).foregroundStyle(.secondary) }
            HStack {
              Button("Rename") { begin("rename", key: key) }
              Spacer()
              Button("Remove", role: .destructive) { begin("remove", key: key) }
            }.buttonStyle(.borderless)
          }.padding(.vertical, 6)
        }
        if keys.isEmpty { Text("No passkeys yet. Add one on a device you trust.").foregroundStyle(.secondary) }
        Button { begin("add") } label: { Label("Add passkey", systemImage: "plus") }.disabled(session.demo)
      } footer: {
        Text("Use Face ID, Touch ID, or your device passcode to sign in. Your password and authenticator remain available as a fallback.")
      }
      if let message { Label(message, systemImage: "checkmark.circle").foregroundStyle(Color.speckTint) }
      if let error { InlineError(text: error) }
    }.navigationTitle("Passkeys").scrollContentBackground(.hidden).background(Color.paper)
      .sessionTask(session) { await load() }.sessionRefreshable(session) { await load() }
      .sheet(isPresented: $showingSheet, onDismiss: { password = ""; code = "" }) {
        NavigationStack {
          Form {
            if operation == "remove" {
              Text("Remove \(selected["name"].string)? Sessions opened with this passkey will be signed out. Your remote sessions will close.")
            } else { TextField("Passkey name", text: $name).autocorrectionDisabled() }
            if operation != "rename" {
              SecureField("Current password", text: $password).textContentType(.password)
              TextField("Authenticator or recovery code, if enabled", text: $code)
                .textContentType(.oneTimeCode).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            if let error { InlineError(text: error) }
            Button(busy ? "Working…" : operation == "remove" ? "Remove passkey" : operation == "rename" ? "Save name" : "Create passkey") {
              save()
            }.disabled(busy || (operation != "remove" && name.trimmingCharacters(in: .whitespaces).isEmpty) || (operation != "rename" && password.isEmpty))
          }.scrollContentBackground(.hidden).background(Color.paper).navigationTitle(operation == "add" ? "Add passkey" : operation == "rename" ? "Rename passkey" : "Remove passkey")
            .navigationBarTitleDisplayMode(.inline).toolbar {
              ToolbarItem(placement: .cancellationAction) { Button("Cancel") { showingSheet = false }.disabled(busy) }
            }
        }.interactiveDismissDisabled(busy)
      }
  }
  private func begin(_ operation: String, key: JSON = .null) {
    self.operation = operation; selected = key; name = key["name"].string
    password = ""; code = ""; error = nil; message = nil; showingSheet = true
  }
  private func save() {
    busy = true; error = nil
    session.perform {
      do {
        if operation == "add" {
          try await session.addPasskey(name: name.trimmingCharacters(in: .whitespacesAndNewlines), password: password, code: code)
        } else if operation == "rename" {
          _ = try await session.request("/access/passkeys/" + selected["id"].string, method: "PATCH", body: .object(["name": .string(name)]))
        } else {
          _ = try await session.request("/access/passkeys/" + selected["id"].string + "/remove", method: "POST",
            body: .object(["password": .string(password), "code": .string(code)]))
        }
        showingSheet = false; password = ""; code = ""; message = "Passkeys updated."
        await load()
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
  private func load() async {
    guard !session.demo else { return }
    do { keys = try await session.request("/access/passkeys").array }
    catch { self.error = error.localizedDescription }
  }
}
