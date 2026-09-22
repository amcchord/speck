import SwiftUI

struct FleetWorkspaceView: View {
  @Environment(\.horizontalSizeClass) private var sizeClass
  @State private var selected: Device?
  var body: some View {
    if sizeClass == .regular {
      NavigationSplitView {
        FleetView(selection: $selected).navigationSplitViewColumnWidth(
          min: 320, ideal: 400, max: 480)
      } detail: {
        NavigationStack {
          if let selected {
            DeviceDetailView(initialDevice: selected).id(selected.id)
          } else {
            EmptyState(
              title: "Choose a machine", symbol: "desktopcomputer",
              detail: "Inspect its health, open a screen, or run a command."
            ).background(Color.paper)
          }
        }
      }.navigationSplitViewStyle(.balanced)
    } else {
      NavigationStack { FleetView() }
    }
  }
}
struct FleetView: View {
  var selection: Binding<Device?>? = nil
  @Environment(SpeckSession.self) private var session
  @State private var search = ""
  @State private var filter = "All"
  private let filters = ["All", "Online", "Offline", "Windows", "Linux", "Restored"]
  var filtered: [Device] {
    session.devices.filter { d in
      (search.isEmpty
        || [d.name, d.site, d.os, d.address].joined(separator: " ")
          .localizedCaseInsensitiveContains(search))
        && (filter == "All" || filter == "Online" && d.online || filter == "Offline" && !d.online
          || filter == "Windows" && d.windows || filter == "Linux" && !d.windows
          || filter == "Restored" && d.restored)
    }
  }
  var body: some View {
    List {
      Section {
        MetricPair {
          MetricTile(
            title: "Online", value: "\(session.devices.filter(\.online).count)",
            symbol: "checkmark.circle")
          MetricTile(title: "Need attention", value: "\(session.activeAlerts)", symbol: "bell")
        }.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(filters, id: \.self) { item in
              Button {
                filter = item
              } label: {
                Text(item).font(.subheadline.weight(.medium)).padding(.horizontal, 16).frame(
                  minHeight: 44
                ).background(
                  filter == item ? Color.speckTint : Color.secondary.opacity(0.08), in: Capsule()
                ).foregroundStyle(filter == item ? Color.paper : .primary)
              }.buttonStyle(.plain).accessibilityAddTraits(filter == item ? .isSelected : [])
            }
          }.padding(.vertical, 4)
        }.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
        if let error = session.error {
          InlineError(text: error) { Task { await session.refresh() } }.listRowInsets(EdgeInsets())
            .listRowBackground(Color.clear)
        }
      }.listRowSeparator(.hidden)
      Section {
        ForEach(filtered) { device in
          if let selection {
            Button {
              selection.wrappedValue = device
            } label: {
              DeviceRow(device: device)
            }
            .buttonStyle(.plain)
            .listRowBackground(
              selection.wrappedValue?.id == device.id
                ? Color.speckTint.opacity(0.08) : Color(uiColor: .secondarySystemGroupedBackground))
          } else {
            NavigationLink(value: device) { DeviceRow(device: device) }
          }
        }
      } header: {
        HStack {
          Text("\(filtered.count) machines")
          Spacer()
          if session.refreshing { ProgressView().controlSize(.mini) }
        }
      } footer: {
        if let date = session.lastRefresh {
          Text("Updated \(date.formatted(date: .omitted, time: .shortened)) · Pull to refresh")
        }
      }
      if filtered.isEmpty && !session.refreshing {
        EmptyState(
          title: search.isEmpty ? "No machines" : "No matches", symbol: "desktopcomputer",
          detail: search.isEmpty
            ? "Enrolled machines will appear here." : "Try another name, site, or address."
        ).listRowBackground(Color.clear)
      }
    }.scrollContentBackground(.hidden).background(Color.paper).listSectionSpacing(20)
      .navigationTitle("Fleet").searchable(
        text: $search, placement: .navigationBarDrawer(displayMode: .always),
        prompt: "Machines, sites, addresses"
      )
      .navigationDestination(for: Device.self) { DeviceDetailView(initialDevice: $0) }
      .refreshable { await session.refresh() }
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            Task { await session.refresh() }
          } label: {
            Image(systemName: "arrow.clockwise")
          }.accessibilityLabel("Refresh fleet").disabled(session.refreshing)
        }
      }
  }
}
struct DeviceRow: View {
  @Environment(\.dynamicTypeSize) private var typeSize
  var device: Device
  var body: some View {
    VStack(alignment: .leading, spacing: 13) {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: device.windows ? "desktopcomputer" : "server.rack").font(.title3).frame(
          width: 40, height: 40
        ).background(Color.speckTint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
          .foregroundStyle(Color.speckTint)
        VStack(alignment: .leading, spacing: 4) {
          Text(device.name).font(.headline).lineLimit(2)
          Text(device.os.isEmpty ? titleCase(device.platform) : device.os).font(.caption)
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 4)
        Circle().fill(device.online ? Color.speckTint : .secondary).frame(width: 7, height: 7)
          .padding(.top, 8).accessibilityLabel(device.status)
      }
      Group {
        if device.restored || typeSize.isAccessibilitySize {
          VStack(alignment: .leading, spacing: 8) {
            statusLine
            usageLine
          }
        } else {
          HStack(spacing: 12) {
            statusLine
            Spacer(minLength: 0)
            usageLine
          }
        }
      }.font(.caption)
      if !device.site.isEmpty {
        Label(device.site, systemImage: "building.2").font(.caption).foregroundStyle(.secondary)
      }
    }.padding(.vertical, 8)
  }
  private var statusLine: some View {
    HStack(spacing: 12) {
      Text(device.status).foregroundStyle(device.online ? Color.speckTint : Color.secondary)
      if device.restored {
        HStack(spacing: 6) {
          Image(systemName: "arrow.counterclockwise")
          Text("Restored")
        }
      }
    }.fixedSize(horizontal: false, vertical: true)
  }
  private var usageLine: some View {
    HStack(spacing: 12) {
      Text("CPU \(Int(device.cpu))%").monospacedDigit()
      Text("RAM \(Int(device.memory))%").monospacedDigit()
    }.fixedSize(horizontal: false, vertical: true)
  }
}
