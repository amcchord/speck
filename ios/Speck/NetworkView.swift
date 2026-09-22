import SwiftUI

struct NetworkView: View {
  @Environment(SpeckSession.self) private var session
  var device: Device
  @State private var target = ""
  @State private var kind = "ping"
  @State private var port = "443"
  @State private var job: Job?
  @State private var error: String?
  @State private var busy = false
  var network: JSON {
    (session.devices.first(where: { $0.id == device.id }) ?? device).telemetry["network"]
  }
  var dnsServers: [String] { NetworkReport.dnsServers(network) }
  var body: some View {
    List {
      if session.canManage {
        Section("Run from \(device.name)") {
          Picker("Check", selection: $kind) {
            Text("Ping").tag("ping")
            Text("DNS lookup").tag("dns")
            Text("TCP port").tag("tcp")
            Text("Traceroute").tag("trace")
          }
          TextField("Hostname or IP address", text: $target).textInputAutocapitalization(.never)
            .autocorrectionDisabled().keyboardType(.URL)
          if kind == "tcp" { TextField("Port", text: $port).keyboardType(.numberPad) }
          Button {
            diagnose()
          } label: {
            Label("Run check", systemImage: "waveform.path")
          }.disabled(busy || target.isEmpty || !device.manageable)
          if let job {
            NavigationLink {
              JobDetailView(initialJob: job)
            } label: {
              Label("View result", systemImage: "terminal")
            }
          }
          if let error { InlineError(text: error) }
        }
      }
      Section("Interfaces") {
        ForEach(Array(network["interfaces"].array.enumerated()), id: \.offset) { _, interface in
          VStack(alignment: .leading, spacing: 8) {
            Text(interface["name"].string).font(.headline)
            ForEach(interface["addrs"].array.map { $0["address"].string }, id: \.self) {
              Text($0).font(.subheadline.monospaced()).textSelection(.enabled)
            }
            HStack {
              Text(interface["mac"].string)
              Spacer()
              Text("MTU \(Int(interface["mtu"].number))")
            }.font(.caption.monospaced()).foregroundStyle(.secondary)
          }.padding(.vertical, 6)
        }
      }
      Section("DNS servers") {
        ForEach(dnsServers, id: \.self) {
          Text($0).font(.subheadline.monospaced()).textSelection(.enabled)
        }
      }
      Section("Routes") {
        ForEach(Array(network["routes"].array.enumerated()), id: \.offset) { _, route in
          VStack(alignment: .leading, spacing: 5) {
            Text(NetworkReport.destination(route)).font(.subheadline.monospaced())
            Text("Via \(NetworkReport.gateway(route)) · \(NetworkReport.interface(route))").font(
              .caption
            ).foregroundStyle(.secondary)
          }.textSelection(.enabled)
        }
      }
      Section("Traffic") {
        ForEach(Array(network["counters"].array.enumerated()), id: \.offset) { _, counter in
          VStack(alignment: .leading, spacing: 8) {
            Text(counter["name"].string).font(.subheadline.weight(.medium))
            HStack {
              Label(formattedBytes(counter["bytesRecv"].number), systemImage: "arrow.down")
              Spacer()
              Label(formattedBytes(counter["bytesSent"].number), systemImage: "arrow.up")
            }.font(.caption).foregroundStyle(.secondary)
          }
        }
      }
      Section("Connections") {
        ForEach(Array(network["connections"].array.prefix(200).enumerated()), id: \.offset) {
          _, connection in
          VStack(alignment: .leading, spacing: 5) {
            HStack {
              Text(
                connection["process"].string.isEmpty
                  ? "PID \(Int(connection["pid"].number))" : connection["process"].string
              ).font(.subheadline.weight(.medium))
              Spacer()
              Text(connection["status"].string).font(.caption2).foregroundStyle(.secondary)
            }
            Text(
              "\(connection["local"]["ip"].string):\(Int(connection["local"]["port"].number)) → \(connection["remote"]["ip"].string):\(Int(connection["remote"]["port"].number))"
            ).font(.caption.monospaced()).textSelection(.enabled)
          }.padding(.vertical, 5)
        }
      }
    }.scrollContentBackground(.hidden).background(Color.paper).navigationTitle("Network")
      .navigationBarTitleDisplayMode(.inline).refreshable {
        await session.refresh()
      }
  }
  func diagnose() {
    guard kind != "tcp" || (1...65535).contains(Int(port) ?? 0) else {
      error = "Enter a port between 1 and 65535."
      return
    }
    busy = true
    error = nil
    Task {
      do {
        job = try await session.submit(
          device: device, kind: "network.check",
          payload: .object([
            "target": .string(target), "kind": .string(kind), "port": .number(Double(port) ?? 443),
          ]))
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}

/// Agent reports preserve the host OS route/DNS field names.
enum NetworkReport {
  static func dnsServers(_ network: JSON) -> [String] {
    Array(
      Set(
        network["dns_servers"].array.flatMap { entry -> [String] in
          if !entry.string.isEmpty { return [entry.string] }
          return entry["ServerAddresses"].array.map(\.string).filter { !$0.isEmpty }
        })
    ).sorted()
  }
  static func destination(_ route: JSON) -> String {
    value(route, ["DestinationPrefix", "dst", "destination"], fallback: "default")
  }
  static func gateway(_ route: JSON) -> String {
    value(route, ["NextHop", "gateway"], fallback: "direct")
  }
  static func interface(_ route: JSON) -> String {
    value(route, ["InterfaceAlias", "dev", "interface"], fallback: "—")
  }
  private static func value(_ row: JSON, _ keys: [String], fallback: String) -> String {
    keys.map { row[$0].string }.first { !$0.isEmpty } ?? fallback
  }
}
