import SwiftUI

struct RecoveryView: View {
  @Environment(SpeckSession.self) private var session
  @State private var plans: [JSON] = []
  @State private var runs: [JSON] = []
  @State private var error: String?
  @State private var selectedPlan: JSON?
  @State private var confirm = false
  @State private var busy = false
  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 8) {
          Label("Slide recovery", systemImage: "arrow.counterclockwise.icloud").font(
            .title2.weight(.semibold))
          Text("Verify that your machines work together after a restore.").font(.subheadline)
            .foregroundStyle(.secondary)
        }.padding(.vertical, 8)
      }
      if let error { InlineError(text: error) { Task { await load() } } }
      Section("Recovery plans") {
        ForEach(Array(plans.enumerated()), id: \.offset) { _, plan in
          VStack(alignment: .leading, spacing: 12) {
            Text(plan["name"].string).font(.headline)
            Text("\(plan["spec"]["members"].array.count) machines · Isolated recovery network")
              .font(.caption).foregroundStyle(.secondary)
            Button {
              selectedPlan = plan
              confirm = true
            } label: {
              ActionLabel(title: "Start recovery test", symbol: "play.circle")
            }.buttonStyle(PrimaryButton(secondary: true)).disabled(busy)
          }.padding(.vertical, 6)
        }
        if plans.isEmpty {
          Text("Configure a recovery plan in the web console.").foregroundStyle(.secondary)
        }
      }
      Section("Recent tests") {
        ForEach(Array(runs.enumerated()), id: \.offset) { _, run in
          NavigationLink {
            RecoveryRunView(initialRun: run)
          } label: {
            VStack(alignment: .leading, spacing: 9) {
              HStack {
                Text(run["state"]["name"].string).font(.headline)
                Spacer()
                StatusPill(
                  text: run["status"].string,
                  tone: run["status"].string == "failed" ? .red : .speckTint)
              }
              Text(titleCase(run["phase"].string)).font(.subheadline).foregroundStyle(.secondary)
              Text(Date(timeIntervalSince1970: run["created"].number), style: .relative).font(
                .caption
              ).foregroundStyle(.secondary)
            }.padding(.vertical, 5)
          }
        }
      }
    }.navigationTitle("Recovery").scrollContentBackground(.hidden).background(Color.paper).task {
      await load()
    }.refreshable { await load() }
      .alert("Start \(selectedPlan?["name"].string ?? "recovery test")?", isPresented: $confirm) {
        Button("Cancel", role: .cancel) {}
        Button("Start test") { start() }
      } message: {
        Text(
          "Speck will capture baselines and create isolated restored machines using this saved Slide plan. This consumes storage and compute. Original machines remain separate. Follow the run and approve restored candidates in the console."
        )
      }
  }
  func load() async {
    do {
      async let p = session.request("/recovery/plans")
      async let r = session.request("/recovery/runs")
      let (pp, rr) = try await (p, r)
      plans = pp.array
      runs = rr.array
      error = nil
    } catch { self.error = error.localizedDescription }
  }
  func start() {
    guard let selectedPlan else { return }
    busy = true
    Task {
      do {
        _ = try await session.request(
          "/recovery/plans/\(selectedPlan["id"].string)/runs", method: "POST")
        await load()
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}
struct RecoveryRunView: View {
  @Environment(SpeckSession.self) private var session
  let initialRun: JSON
  @State private var updated: JSON?
  @State private var error: String?
  var run: JSON { updated ?? initialRun }
  var body: some View {
    List {
      Section {
        StatusPill(text: run["status"].string)
        LabeledContent("Phase", value: titleCase(run["phase"].string))
        LabeledContent(
          "Started",
          value: Date(timeIntervalSince1970: run["created"].number).formatted(
            date: .abbreviated, time: .shortened))
      }
      if let error { InlineError(text: error) }
      Section("Machines") {
        ForEach(Array(run["state"]["members"].array.enumerated()), id: \.offset) { _, member in
          VStack(alignment: .leading, spacing: 8) {
            Text(
              session.devices.first(where: {
                $0.id == member["source_device_id"].string || $0.id == member["device_id"].string
              })?.name ?? member["source_device_id"].string
            ).font(.headline)
            LabeledContent("Backup", value: titleCase(member["backup_status"].string)).font(
              .subheadline)
            if !member["restored_device_id"].string.isEmpty {
              Label("Restored instance registered separately", systemImage: "checkmark.shield")
                .font(.caption).foregroundStyle(Color.speckTint)
            }
          }.padding(.vertical, 5)
        }
      }
      if !run["report"].object.isEmpty {
        Section("Verification evidence") { CodeBlock(text: run["report"].pretty) }
      }
      if !run["state"]["error"].string.isEmpty {
        Section("Run details") { Text(run["state"]["error"].string).foregroundStyle(.red) }
      }
    }.navigationTitle(run["state"]["name"].string).navigationBarTitleDisplayMode(.inline)
      .task {
        while !Task.isCancelled {
          do {
            updated = try await session.request("/recovery/runs").array.first {
              $0["id"] == initialRun["id"]
            }
          } catch {
            self.error = error.localizedDescription
            break
          }
          if ["passed", "failed", "stopped"].contains(run["status"].string) { break }
          try? await Task.sleep(for: .seconds(5))
        }
      }
  }
}
