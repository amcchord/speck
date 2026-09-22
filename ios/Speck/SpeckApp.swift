import SwiftUI

@main struct SpeckApp: App {
  @State private var session = SpeckSession()
  @Environment(\.scenePhase) private var phase
  var body: some Scene {
    WindowGroup {
      Group {
        if session.restoring {
          ZStack {
            Color.forest.ignoresSafeArea()
            SpeckWordmark(light: true)
          }
        } else if session.signedIn {
          MainView()
        } else {
          SignInView()
        }
      }.environment(session).tint(.speckTint)
        .task { await session.restore() }
        .overlay {
          if phase != .active {
            Color.forest.ignoresSafeArea().overlay { SpeckWordmark(light: true) }
              .accessibilityHidden(true)
          }
        }
    }
  }
}
struct MainView: View {
  @Environment(\.scenePhase) private var phase
  @Environment(SpeckSession.self) private var session
  var body: some View {
    TabView {
      Tab("Fleet", systemImage: "desktopcomputer") { FleetWorkspaceView() }
      Tab("Alerts", systemImage: "bell") { NavigationStack { AlertsView() } }.badge(
        session.activeAlerts)
      if session.canManage {
        Tab("Jobs", systemImage: "terminal") { NavigationStack { JobsView() } }
        Tab("Recovery", systemImage: "arrow.counterclockwise.icloud") {
          NavigationStack { RecoveryView() }
        }
      }
      Tab("Account", systemImage: "person.crop.circle") { NavigationStack { AccountView() } }
    }.tabViewStyle(.sidebarAdaptable)
      .task(id: phase) {
        guard phase == .active else { return }
        while !Task.isCancelled {
          try? await Task.sleep(for: .seconds(20))
          if !Task.isCancelled { await session.refresh() }
        }
      }
  }
}
struct SignInView: View {
  @Environment(SpeckSession.self) private var session
  @State private var username = ""
  @State private var password = ""
  @State private var code = ""
  @State private var server = "https://speckrmm.com"
  @State private var advanced = false
  @State private var busy = false
  @State private var error: String?
  @FocusState private var field: Field?
  enum Field { case username, password, code }
  var body: some View {
    GeometryReader { geo in
      ScrollView {
        VStack(spacing: 0) {
          VStack(alignment: .leading, spacing: 24) {
            SpeckWordmark(light: true)
            Text("A LITTLE LIGHTWEIGHT RMM").font(.caption2.weight(.bold)).tracking(2)
              .foregroundStyle(Color.lime)
          }.frame(maxWidth: .infinity, alignment: .leading).padding(32).frame(
            minHeight: geo.size.height > 700 ? 220 : 150
          ).background(Color.forest)
          VStack(alignment: .leading, spacing: 24) {
            Text("Sign in").font(.largeTitle.weight(.semibold))
            VStack(alignment: .leading, spacing: 8) {
              Text("Username").font(.subheadline.weight(.medium))
              TextField("Username", text: $username).textContentType(.username)
                .textInputAutocapitalization(.never).autocorrectionDisabled().focused(
                  $field, equals: .username
                ).submitLabel(.next).onSubmit { field = .password }.accessibilityIdentifier(
                  "username")
            }
            VStack(alignment: .leading, spacing: 8) {
              Text("Password").font(.subheadline.weight(.medium))
              SecureField("Password", text: $password).textContentType(.password).focused(
                $field, equals: .password
              ).submitLabel(.next).onSubmit { field = .code }.accessibilityIdentifier("password")
            }
            VStack(alignment: .leading, spacing: 8) {
              Text("Authenticator or recovery code").font(.subheadline.weight(.medium))
              TextField("If enabled", text: $code).textContentType(.oneTimeCode)
                .textInputAutocapitalization(.never).autocorrectionDisabled().focused(
                  $field, equals: .code
                ).submitLabel(.go).onSubmit(signIn)
            }
            if let error { InlineError(text: error) }
            Button(action: signIn) {
              HStack {
                if busy { ProgressView().tint(.white) }
                Text(busy ? "Signing in…" : "Sign in")
                Image(systemName: "arrow.right")
              }
            }.buttonStyle(PrimaryButton()).disabled(busy || username.isEmpty || password.isEmpty)
              .accessibilityIdentifier("sign-in")
            DisclosureGroup("Server", isExpanded: $advanced) {
              TextField("https://speckrmm.com", text: $server).keyboardType(.URL)
                .textInputAutocapitalization(.never).autocorrectionDisabled().padding(.top, 12)
            }.font(.subheadline).foregroundStyle(.secondary)
          }.textFieldStyle(SpeckFieldStyle()).padding(32).frame(maxWidth: 520).frame(
            maxWidth: .infinity)
        }.frame(maxWidth: 780).frame(maxWidth: .infinity)
      }.background(Color.paper).scrollDismissesKeyboard(.interactively)
    }
  }
  private func signIn() {
    guard !busy, !username.isEmpty, !password.isEmpty else { return }
    busy = true
    error = nil
    field = nil
    Task {
      do {
        try await session.signIn(server: server, username: username, password: password, code: code)
        password = ""
        code = ""
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}
struct SpeckFieldStyle: TextFieldStyle {
  func _body(configuration: TextField<Self._Label>) -> some View {
    configuration.padding(14).background(.background, in: RoundedRectangle(cornerRadius: 10))
      .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(.quaternary) }
  }
}
