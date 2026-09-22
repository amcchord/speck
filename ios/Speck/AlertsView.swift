import SwiftUI

struct AlertsView: View {
  @Environment(SpeckSession.self) private var session
  @State private var state = "active"
  @State private var items: [AlertItem] = []
  @State private var error: String?
  @State private var loading = false
  var body: some View {
    List {
      Section {
        Picker("Alert state", selection: $state) {
          Text("Active").tag("active")
          Text("Resolved").tag("resolved")
          Text("All").tag("all")
        }.pickerStyle(.segmented)
      }.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
      if let error { InlineError(text: error) { session.perform { await load() } } }
      ForEach(items) { item in
        VStack(alignment: .leading, spacing: 12) {
          HStack {
            Image(systemName: item.resolved ? "checkmark.circle" : "exclamationmark.circle")
              .foregroundStyle(item.resolved ? Color.speckTint : Color.speckWarning)
            Text(item.title).font(.headline)
            Spacer()
          }
          if let device = session.devices.first(where: { $0.id == item.deviceID }) {
            NavigationLink(value: device) { Text(device.name).font(.subheadline) }
          }
          HStack {
            StatusPill(
              text: item.resolved
                ? "Resolved" : item.acknowledged ? "Acknowledged" : "Needs attention",
              tone: item.resolved ? .speckTint : .speckWarning)
            Spacer()
            if !item.acknowledged && !item.resolved && session.canManage {
              Button("Acknowledge") { acknowledge(item) }.font(.subheadline.weight(.semibold))
                .buttonStyle(.bordered)
            }
          }
        }.padding(.vertical, 8)
      }
      if loading {
        ProgressView("Loading alerts…")
      } else if items.isEmpty && error == nil {
        EmptyState(
          title: state == "active" ? "All clear" : "No alerts", symbol: "checkmark.shield",
          detail: state == "active"
            ? "There are no active alerts for this fleet."
            : "Alerts will appear here as conditions change.")
      }
    }.navigationTitle("Alerts").scrollContentBackground(.hidden).background(Color.paper)
      .navigationDestination(for: Device.self) { DeviceDetailView(initialDevice: $0) }
      .sessionTask(session, id: state) { await load() }.sessionRefreshable(session) {
        await load()
        await session.refresh()
      }
  }
  func load() async {
    loading = true
    defer { loading = false }
    do {
      items = try await session.request("/alerts?state=\(state)&limit=100")["items"].array.map(
        AlertItem.init)
      error = nil
    } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
  }
  func acknowledge(_ item: AlertItem) {
    session.perform {
      do {
        _ = try await session.request(
          "/alerts/" + item.id, method: "POST", body: .object(["action": .string("acknowledge")]))
        await load()
        await session.refresh()
      } catch { self.error = error.localizedDescription }
    }
  }
}
