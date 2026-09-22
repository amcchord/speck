import SwiftUI

struct DeviceDetailView: View {
  @Environment(SpeckSession.self) private var session
  @Environment(\.dynamicTypeSize) private var typeSize
  let initialDevice: Device
  @State private var remote = false
  @State private var command = false
  @State private var organize = false
  var device: Device {
    session.devices.first(where: { $0.id == initialDevice.id }) ?? initialDevice
  }
  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 16) {
          HStack {
            StatusPill(text: device.status, tone: device.online ? .speckTint : .secondary)
            if device.restored { StatusPill(text: "Restored", tone: .orange) }
            Spacer()
          }
          Text(device.os).font(.subheadline).foregroundStyle(.secondary)
          if session.canManage {
            if typeSize.isAccessibilitySize {
              VStack(spacing: 12) { connectionButtons }
            } else {
              HStack(spacing: 12) { connectionButtons }
            }
          }
          if !device.approved {
            Label(
              "This restored instance needs approval in the console before it can be managed.",
              systemImage: "person.crop.circle.badge.checkmark"
            ).font(.footnote).foregroundStyle(.secondary)
          }
          if !device.online {
            Text("Last seen \(device.lastSeen.formatted(date: .abbreviated, time: .shortened))")
              .font(.footnote).foregroundStyle(.secondary)
          }
        }.padding(.vertical, 6)
      }
      Section {
        MetricPair {
          MetricTile(title: "CPU", value: "\(Int(device.cpu))%", symbol: "cpu")
          MetricTile(title: "Memory", value: "\(Int(device.memory))%", symbol: "memorychip")
        }.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
      }
      if session.canManage && device.approved {
        Section("Screen") { ScreenPreviewView(device: device) }
      }
      Section("Manage") {
        NavigationLink {
          ServicesView(device: device)
        } label: {
          Label("Services", systemImage: "gearshape.2")
        }
        NavigationLink {
          NetworkView(device: device)
        } label: {
          Label("Network", systemImage: "network")
        }
        if session.canManage {
          NavigationLink {
            FilesView(device: device)
          } label: {
            Label("Files", systemImage: "folder")
          }.disabled(!device.manageable)
          NavigationLink {
            DevicePatchesView(device: device)
          } label: {
            Label("Updates", systemImage: "arrow.triangle.2.circlepath")
          }
          NavigationLink {
            JobsView(deviceID: device.id)
          } label: {
            Label("Job history", systemImage: "clock.arrow.circlepath")
          }
        }
      }
      Section("Machine") {
        LabeledContent("Hostname", value: device.raw["hostname"].string)
        LabeledContent("Address", value: device.address).textSelection(.enabled)
        LabeledContent("Agent", value: device.telemetry["version"].string)
        LabeledContent(
          "Uptime",
          value: Duration.seconds(device.telemetry["host"]["uptime"].number).formatted(
            .units(allowed: [.days, .hours], width: .abbreviated)))
        if !device.site.isEmpty { LabeledContent("Site", value: device.site) }
        if !device.raw["tags"].array.isEmpty {
          LabeledContent(
            "Tags", value: device.raw["tags"].array.map(\.string).joined(separator: ", "))
        }
        if device.raw["maintenance_until"].number > Date().timeIntervalSince1970 {
          Label(
            "Maintenance until \(Date(timeIntervalSince1970: device.raw["maintenance_until"].number).formatted(date: .omitted, time: .shortened))",
            systemImage: "wrench.adjustable"
          ).foregroundStyle(.orange)
        }
      }
      if !device.telemetry["active_app"].isNull {
        Section("Active application") {
          LabeledContent("Process", value: device.telemetry["active_app"]["process"].string)
          Text(device.telemetry["active_app"]["title"].string).font(.subheadline)
          LabeledContent("User", value: device.telemetry["active_app"]["user"].string)
        }
      }
      Section("Storage") {
        ForEach(Array(device.telemetry["disks"].array.enumerated()), id: \.offset) { _, disk in
          VStack(alignment: .leading, spacing: 8) {
            HStack {
              Text(disk["path"].string).font(.subheadline.weight(.medium))
              Spacer()
              Text("\(Int(disk["usedPercent"].number))%").font(.caption).foregroundStyle(.secondary)
            }
            ProgressView(value: min(100, max(0, disk["usedPercent"].number)), total: 100)
            Text(
              "\(formattedBytes(disk["used"].number)) of \(formattedBytes(disk["total"].number))"
            ).font(.caption).foregroundStyle(.secondary)
          }.padding(.vertical, 6)
        }
      }
      Section("Slide") {
        if device.raw["slide_agent_id"].string.isEmpty {
          Label("Not linked to a Slide agent", systemImage: "externaldrive.badge.questionmark")
            .foregroundStyle(.secondary)
        } else {
          Label("Linked to Slide", systemImage: "checkmark.shield")
          Text(device.raw["slide_agent_id"].string).font(.caption.monospaced()).textSelection(
            .enabled)
        }
      }
    }.scrollContentBackground(.hidden).background(Color.paper).navigationTitle(device.name)
      .navigationBarTitleDisplayMode(.inline)
      .refreshable { await session.refresh() }
      .toolbar {
        if session.canManage {
          Button {
            organize = true
          } label: {
            Image(systemName: "slider.horizontal.3")
          }.accessibilityLabel("Organize machine")
        }
      }
      .sheet(isPresented: $command) { NavigationStack { CommandView(device: device) } }
      .sheet(isPresented: $organize) { NavigationStack { OrganizeView(device: device) } }
      .fullScreenCover(isPresented: $remote) { RemoteView(device: device) }
  }
  @ViewBuilder private var connectionButtons: some View {
    Button {
      remote = true
    } label: {
      ActionLabel(
        title: device.raw["remote_protocol"].string == "ssh" ? "SSH" : "Screen", symbol: "display")
    }
    .buttonStyle(PrimaryButton()).disabled(
      !device.manageable || !device.raw["remote_configured"].bool)
    Button {
      command = true
    } label: {
      ActionLabel(title: device.windows ? "PowerShell" : "Shell", symbol: "terminal")
    }
    .buttonStyle(PrimaryButton(secondary: true)).disabled(!device.manageable)
  }

}
struct ServicesView: View {
  @Environment(SpeckSession.self) private var session
  var device: Device
  @State private var search = ""
  @State private var selected: JSON?
  @State private var action = "restart"
  @State private var confirm = false
  @State private var job: Job?
  @State private var error: String?
  @State private var busy = false
  var services: [JSON] {
    (session.devices.first(where: { $0.id == device.id }) ?? device).telemetry["services"].array
      .filter {
        search.isEmpty
          || ($0["name"].string + " " + $0["display_name"].string).localizedCaseInsensitiveContains(
            search)
      }
  }
  var body: some View {
    List {
      if let error { InlineError(text: error) }
      if let job {
        NavigationLink {
          JobDetailView(initialJob: job)
        } label: {
          Label("View \(job.status) job", systemImage: "clock")
        }
      }
      ForEach(Array(services.enumerated()), id: \.offset) { _, service in
        HStack {
          VStack(alignment: .leading, spacing: 5) {
            Text(
              service["display_name"].string.isEmpty
                ? service["name"].string : service["display_name"].string
            ).font(.subheadline.weight(.medium))
            Text(service["name"].string).font(.caption.monospaced()).foregroundStyle(.secondary)
          }
          Spacer()
          StatusPill(
            text: service["status"].string,
            tone: service["status"].string == "running" ? .speckTint : .secondary)
          if session.canManage {
            Menu {
              ForEach(["start", "restart", "stop"], id: \.self) { op in
                Button(titleCase(op), role: op == "stop" ? .destructive : nil) {
                  selected = service
                  action = op
                  confirm = true
                }
              }
            } label: {
              Image(systemName: "ellipsis.circle").frame(width: 44, height: 44)
            }.disabled(!device.manageable || busy).accessibilityLabel(
              "Actions for \(service["name"].string)")
          }
        }.padding(.vertical, 4)
      }
    }.scrollContentBackground(.hidden).background(Color.paper).navigationTitle("Services")
      .refreshable { await session.refresh() }.searchable(
        text: $search, prompt: "Find a service"
      )
      .alert("\(titleCase(action)) service?", isPresented: $confirm) {
        Button("Cancel", role: .cancel) {}
        Button(titleCase(action), role: action == "stop" ? .destructive : nil) { run() }
      } message: {
        Text(
          "\(selected?["display_name"].string ?? "Service") on \(device.name). This can interrupt applications using the service."
        )
      }
  }
  func run() {
    guard let selected else { return }
    busy = true
    error = nil
    Task {
      do {
        job = try await session.submit(
          device: device, kind: "service.control",
          payload: .object(["name": selected["name"], "action": .string(action)]))
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}
struct OrganizeView: View {
  @Environment(SpeckSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  var device: Device
  @State private var site = ""
  @State private var tags = ""
  @State private var maintenance = false
  @State private var error: String?
  @State private var busy = false
  var body: some View {
    Form {
      Section {
        TextField("Site", text: $site)
        TextField("Tags, separated by commas", text: $tags).textInputAutocapitalization(.never)
      }
      Section {
        Toggle("Maintenance for one hour", isOn: $maintenance)
      } footer: {
        Text("Pause health alerts while you work on this machine.")
      }
      if let error { InlineError(text: error) }
    }.scrollContentBackground(.hidden).background(Color.paper).navigationTitle("Organize machine")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) { Button("Save") { save() }.disabled(busy) }
      }.onAppear {
        site = device.site
        tags = device.raw["tags"].array.map(\.string).joined(separator: ", ")
        maintenance = device.raw["maintenance_until"].number > Date().timeIntervalSince1970
      }
  }
  func save() {
    busy = true
    Task {
      do {
        _ = try await session.request(
          "/devices/\(device.id)/organization", method: "PUT",
          body: .object([
            "site": .string(site),
            "tags": .array(
              tags.split(separator: ",").map {
                .string($0.trimmingCharacters(in: .whitespacesAndNewlines))
              }.filter { !$0.string.isEmpty }),
            "maintenance_until": .number(
              maintenance
                ? (device.raw["maintenance_until"].number > Date().timeIntervalSince1970
                  ? device.raw["maintenance_until"].number
                  : Date().addingTimeInterval(3600).timeIntervalSince1970) : 0),
          ]))
        await session.refresh()
        dismiss()
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}
