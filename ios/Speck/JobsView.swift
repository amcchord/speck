import SwiftUI

struct JobsView: View {
  @Environment(SpeckSession.self) private var session
  var deviceID: String? = nil
  @State private var jobs: [Job] = []
  @State private var error: String?
  @State private var loading = true
  var body: some View {
    List {
      if deviceID == nil {
        Section {
          NavigationLink {
            TemplatesView()
          } label: {
            Label("Software & scripts", systemImage: "shippingbox")
          }
          NavigationLink {
            SchedulesView()
          } label: {
            Label("Schedules", systemImage: "calendar.badge.clock")
          }
        }
      }
      if let error { InlineError(text: error) { session.perform { await load() } } }
      Section("Recent jobs") {
        ForEach(jobs) { job in
          NavigationLink {
            JobDetailView(initialJob: job)
          } label: {
            VStack(alignment: .leading, spacing: 8) {
              HStack {
                Text(titleCase(job.kind)).font(.headline)
                Spacer()
                StatusPill(text: job.status, tone: job.status == "failed" ? .red : .speckTint)
              }
              Text(session.devices.first(where: { $0.id == job.deviceID })?.name ?? job.deviceID)
                .font(.subheadline).foregroundStyle(.secondary)
              Text(job.created, style: .relative).font(.caption).foregroundStyle(.secondary)
            }.padding(.vertical, 5)
          }
        }
      }
      if loading {
        ProgressView("Loading jobs…")
      } else if jobs.isEmpty && error == nil {
        EmptyState(
          title: "No jobs yet", symbol: "terminal",
          detail: "Commands and management actions appear here.")
      }
    }.navigationTitle("Jobs").scrollContentBackground(.hidden).background(Color.paper).sessionTask(session) {
      await load()
    }.sessionRefreshable(session) { await load() }
  }
  func load() async {
    do {
      jobs = try await session.request("/jobs" + (deviceID.map { "?device_id=" + $0 } ?? "")).array
        .map(Job.init)
      error = nil
    } catch { self.error = error.localizedDescription }
    loading = false
  }
}
struct JobDetailView: View {
  @Environment(SpeckSession.self) private var session
  let initialJob: Job
  @State private var updated: Job?
  @State private var error: String?
  var job: Job { updated ?? initialJob }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        HStack {
          StatusPill(text: job.status, tone: job.status == "failed" ? .red : .speckTint)
          Spacer()
          if !job.finished { ProgressView() }
        }
        Text(session.devices.first(where: { $0.id == job.deviceID })?.name ?? job.deviceID).font(
          .headline)
        LabeledContent(
          "Started", value: job.created.formatted(date: .abbreviated, time: .shortened)
        ).font(.subheadline)
        if let error { InlineError(text: error) }
        if !job.result["exit_code"].isNull {
          LabeledContent("Exit code", value: "\(Int(job.result["exit_code"].number))").font(
            .subheadline)
        }
        CodeBlock(text: job.output)
        if job.result["truncated"].bool {
          Label("Output was truncated by the agent.", systemImage: "text.badge.minus").font(
            .footnote
          ).foregroundStyle(.orange)
        }
      }.padding(20).frame(maxWidth: 1000, alignment: .leading).frame(maxWidth: .infinity)
    }.background(Color.paper).navigationTitle(titleCase(job.kind)).navigationBarTitleDisplayMode(
      .inline
    )
    .sessionTask(session) {
      while !Task.isCancelled {
        do {
          updated = Job(raw: try await session.request("/jobs/" + job.id))
          error = nil
        } catch {
          self.error = error.localizedDescription
          break
        }
        if job.finished { break }
        try? await Task.sleep(for: .seconds(2))
      }
    }
  }
}
struct CommandView: View {
  @Environment(SpeckSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  var device: Device
  @State private var script = ""
  @State private var confirm = false
  @State private var job: Job?
  @State private var error: String?
  @State private var busy = false
  @State private var aiPrompt = ""
  @State private var aiNote = ""
  var body: some View {
    Form {
      Section {
        Label(device.name, systemImage: device.windows ? "desktopcomputer" : "server.rack")
      }
      Section {
        CodeEditor(text: $script).frame(minHeight: 180, idealHeight: 220)
      } header: {
        Text(device.windows ? "PowerShell" : "Shell script")
      } footer: {
        Text("Runs with the agent’s privileges on \(device.name). Output is recorded in Jobs.")
      }
      Section {
        TextField("What should the script do?", text: $aiPrompt, axis: .vertical).lineLimit(2...5)
        Button {
          draft()
        } label: {
          Label("Draft script", systemImage: "sparkles")
        }.disabled(busy || aiPrompt.isEmpty)
        if !aiNote.isEmpty { Text(aiNote).font(.footnote).foregroundStyle(.secondary) }
      } header: {
        Text("Draft with AI")
      } footer: {
        Text(
          "Sends your prompt to your server’s configured OpenAI account. Review the script before running it."
        )
      }
      if busy { ProgressView() }
      if let error { InlineError(text: error) }
      if let job {
        NavigationLink {
          JobDetailView(initialJob: job)
        } label: {
          Label("Open job result", systemImage: "terminal")
        }
      }
    }.scrollContentBackground(.hidden).background(Color.paper)
      .scrollDismissesKeyboard(.interactively)
      .safeAreaInset(edge: .bottom) {
        Button {
          dismissKeyboard()
          confirm = true
        } label: {
          ActionLabel(title: "Review & run", symbol: "play.fill")
        }
        .buttonStyle(PrimaryButton())
        .disabled(
          busy || script.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !device.manageable
        )
        .padding(.horizontal, 20).padding(.vertical, 12).background(Color.paper)
      }
      .navigationTitle(device.windows ? "PowerShell" : "Shell").navigationBarTitleDisplayMode(
        .inline
      )
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
        ToolbarItemGroup(placement: .keyboard) {
          Spacer()
          Button("Hide keyboard") { dismissKeyboard() }
        }
      }
      .confirmationDialog(
        "Run on \(device.name)?", isPresented: $confirm, titleVisibility: .visible
      ) {
        Button("Run script") { run() }
      } message: {
        Text("The script shown above will execute with the Speck Agent’s privileges.")
      }
  }
  func run() {
    busy = true
    error = nil
    session.perform {
      do {
        job = try await session.submit(
          device: device, kind: "command",
          payload: .object([
            "script": .string(script), "shell": .string(device.windows ? "powershell" : "sh"),
          ]), timeout: 180)
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
  func draft() {
    busy = true
    error = nil
    session.perform {
      do {
        let value = try await session.request(
          "/ai/assist", method: "POST",
          body: .object([
            "prompt": .string(aiPrompt), "platform": .string(device.platform),
            "device_id": .string(device.id), "mode": .string("assist"),
          ]))
        script = value["script"].string
        aiNote = [value["summary"].string, value["caution"].string].filter { !$0.isEmpty }.joined(
          separator: "\n")
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}
