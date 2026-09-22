import SwiftUI

struct BatchReview: Identifiable {
  var id = UUID()
  var body: JSON
  var preview: JSON
}
struct BatchReviewView: View {
  @Environment(SpeckSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  let review: BatchReview
  @State private var busy = false
  @State private var error: String?
  @State private var result: String?
  var body: some View {
    List {
      Section {
        Text(review.preview["name"].string).font(.headline)
        Text("\(review.preview["targets"].array.count) machines").foregroundStyle(.secondary)
      }
      ForEach(Array(review.preview["targets"].array.enumerated()), id: \.offset) { _, target in
        Section(target["label"].string) { CodeBlock(text: target["script"].string) }
      }
      if let error { InlineError(text: error) }
      if let result {
        Label(result, systemImage: "checkmark.circle").foregroundStyle(Color.speckTint)
      } else {
        Section {
          Button {
            run()
          } label: {
            ActionLabel(title: busy ? "Submitting…" : "Run on these machines")
          }.buttonStyle(PrimaryButton()).disabled(busy)
        } footer: {
          Text(
            "The reviewed scripts will run with each agent’s privileges. Progress appears in Jobs.")
        }
      }
    }.scrollContentBackground(.hidden).background(Color.paper)
      .navigationTitle("Review operation").navigationBarTitleDisplayMode(.inline).toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
      }
  }
  func run() {
    busy = true
    error = nil
    session.perform {
      do {
        var body = review.body.object
        body["confirmed"] = .bool(true)
        _ = try await session.request("/batches", method: "POST", body: .object(body))
        result = "Operation queued. Follow its progress in Jobs."
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}
struct DevicePatchesView: View {
  @Environment(SpeckSession.self) private var session
  var device: Device
  @State private var inventory: JSON = .null
  @State private var selected: Set<String> = []
  @State private var review: BatchReview?
  @State private var busy = false
  @State private var error: String?
  var updates: [JSON] { inventory["report"]["updates"].array }
  var body: some View {
    List {
      Section {
        Button {
          prepare("patch.scan")
        } label: {
          Label("Scan for updates", systemImage: "arrow.clockwise")
        }.disabled(busy || !device.manageable)
        if inventory["scanned"].number > 0 {
          LabeledContent(
            "Last scan",
            value: Date(timeIntervalSince1970: inventory["scanned"].number).formatted(
              date: .abbreviated, time: .shortened)
          ).font(.caption)
        }
        if inventory["report"]["reboot_required"].bool {
          Label("Restart required by the operating system", systemImage: "restart").foregroundStyle(
            Color.speckWarning)
        }
        if let error { InlineError(text: error) }
      }
      Section("\(updates.count) available updates") {
        ForEach(Array(updates.enumerated()), id: \.offset) { _, update in
          Button {
            let id = update["id"].string
            if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
          } label: {
            HStack(spacing: 12) {
              Image(
                systemName: selected.contains(update["id"].string)
                  ? "checkmark.circle.fill" : "circle"
              ).foregroundStyle(Color.speckTint)
              VStack(alignment: .leading, spacing: 5) {
                Text(update["title"].string).font(.subheadline.weight(.medium)).foregroundStyle(
                  .primary)
                Text(
                  [update["version"].string, update["severity"].string].filter { !$0.isEmpty }
                    .joined(separator: " · ")
                ).font(.caption).foregroundStyle(.secondary)
              }
            }.padding(.vertical, 4)
          }.buttonStyle(.plain).accessibilityAddTraits(
            selected.contains(update["id"].string) ? .isSelected : [])
        }
      }
      if !selected.isEmpty {
        Section {
          Button("Review \(selected.count) selected updates") { prepare("patch.install") }.disabled(
            busy || !device.manageable)
        }
      }
      if updates.isEmpty && inventory.isNull {
        Text("Run a scan to collect this machine’s update inventory.").foregroundStyle(.secondary)
      } else if updates.isEmpty {
        Label("No updates reported by the last scan", systemImage: "checkmark.circle")
          .foregroundStyle(Color.speckTint)
      }
    }.scrollContentBackground(.hidden).background(Color.paper).navigationTitle("Updates")
      .navigationBarTitleDisplayMode(.inline).sessionTask(session) { await load() }
      .sessionRefreshable(session) { await load() }
      .sheet(item: $review, onDismiss: { session.perform { await load() } }) { item in
        NavigationStack { BatchReviewView(review: item) }
      }
  }
  func load() async {
    do {
      inventory =
        try await session.request("/patches").array.first(where: {
          $0["device_id"].string == device.id
        }) ?? .null
      selected.formIntersection(Set(updates.map { $0["id"].string }))
      error = nil
    } catch { self.error = error.localizedDescription }
  }
  func prepare(_ kind: String) {
    busy = true
    error = nil
    session.perform {
      do {
        let body: JSON = .object([
          "request_id": .string(UUID().uuidString),
          "name": .string(kind == "patch.scan" ? "Scan \(device.name)" : "Update \(device.name)"),
          "kind": .string(kind), "device_ids": .array([.string(device.id)]),
          "updates": .object([device.id: .array(selected.sorted().map(JSON.string))]),
        ])
        review = BatchReview(
          body: body,
          preview: try await session.request("/batches/preview", method: "POST", body: body))
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}
struct TemplatesView: View {
  @Environment(SpeckSession.self) private var session
  @State private var templates: [JSON] = []
  @State private var error: String?
  var body: some View {
    List {
      if let error { InlineError(text: error) }
      ForEach(Array(templates.enumerated()), id: \.offset) { _, template in
        NavigationLink {
          TemplateRunView(template: template)
        } label: {
          VStack(alignment: .leading, spacing: 7) {
            Text(template["name"].string).font(.headline)
            Text(template["description"].string).font(.subheadline).foregroundStyle(.secondary)
            HStack {
              StatusPill(text: template["platform"].string)
              Text("Revision \(Int(template["revision"].number))").font(.caption).foregroundStyle(
                .secondary)
            }
          }.padding(.vertical, 5)
        }
      }
    }.scrollContentBackground(.hidden).background(Color.paper).navigationTitle("Software & scripts")
      .sessionTask(session) {
        do { templates = try await session.request("/templates").array } catch {
          self.error = error.localizedDescription
        }
      }
  }
}
struct TemplateRunView: View {
  @Environment(SpeckSession.self) private var session
  let template: JSON
  @State private var selected: Set<String> = []
  @State private var parameters: [String: String] = [:]
  @State private var review: BatchReview?
  @State private var error: String?
  @State private var busy = false
  var eligible: [Device] {
    session.devices.filter {
      $0.manageable
        && ($0.platform == template["platform"].string || template["platform"].string == "all")
    }
  }
  var body: some View {
    Form {
      Section { Text(template["description"].string).font(.subheadline) }
      if !template["parameters"].array.isEmpty {
        Section("Parameters") {
          ForEach(Array(template["parameters"].array.enumerated()), id: \.offset) { _, parameter in
            parameterField(parameter)
          }
        }
      }
      Section("Machines") {
        ForEach(eligible) { device in
          Toggle(
            device.name,
            isOn: Binding(
              get: { selected.contains(device.id) },
              set: { if $0 { selected.insert(device.id) } else { selected.remove(device.id) } }))
        }
        if eligible.isEmpty {
          Text("No online, approved machines match this template.").foregroundStyle(.secondary)
        }
      }
      if let error { InlineError(text: error) }
      Section {
        Button {
          prepare()
        } label: {
          ActionLabel(
            title: "Review on \(selected.count) machines", symbol: "doc.text.magnifyingglass")
        }.buttonStyle(PrimaryButton()).disabled(selected.isEmpty || busy)
      }
    }.scrollContentBackground(.hidden).background(Color.paper)
      .navigationTitle(template["name"].string).navigationBarTitleDisplayMode(.inline)
      .sheet(item: $review) { item in NavigationStack { BatchReviewView(review: item) } }
  }
  private func parameterField(_ parameter: JSON) -> some View {
    let name = parameter["name"].string
    let binding = Binding<String>(
      get: { parameters[name] ?? parameter["default"].string }, set: { parameters[name] = $0 })
    return TextField(parameter["label"].string, text: binding).textInputAutocapitalization(.never)
      .autocorrectionDisabled()
  }
  func prepare() {
    busy = true
    session.perform {
      do {
        let body: JSON = .object([
          "request_id": .string(UUID().uuidString), "name": template["name"],
          "kind": .string("template"), "device_ids": .array(selected.sorted().map(JSON.string)),
          "template_id": template["id"], "template_revision": template["revision"],
          "parameters": .object(parameters.mapValues(JSON.string)),
        ])
        review = BatchReview(
          body: body,
          preview: try await session.request("/batches/preview", method: "POST", body: body))
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}
struct SchedulesView: View {
  @Environment(SpeckSession.self) private var session
  @State private var schedules: [JSON] = []
  @State private var error: String?
  var body: some View {
    List {
      if let error { InlineError(text: error) }
      ForEach(Array(schedules.enumerated()), id: \.offset) { _, schedule in
        VStack(alignment: .leading, spacing: 10) {
          HStack {
            Text(schedule["name"].string).font(.headline)
            Spacer()
            StatusPill(text: schedule["enabled"].bool ? "Enabled" : "Paused")
          }
          Text(titleCase(schedule["operation"]["kind"].string)).font(.subheadline).foregroundStyle(
            .secondary)
          if schedule["next_run"].number > 0 {
            Label(
              Date(timeIntervalSince1970: schedule["next_run"].number).formatted(
                date: .abbreviated, time: .shortened), systemImage: "calendar"
            ).font(.caption)
          }
        }.padding(.vertical, 6)
      }
      if schedules.isEmpty && error == nil {
        EmptyState(
          title: "No schedules", symbol: "calendar",
          detail: "Create recurring scans and template runs in the web console.")
      }
    }.scrollContentBackground(.hidden).background(Color.paper)
      .navigationTitle("Schedules").sessionTask(session) { await load() }.sessionRefreshable(session) { await load() }
  }
  func load() async {
    do {
      schedules = try await session.request("/schedules").array
      error = nil
    } catch { self.error = error.localizedDescription }
  }
}
