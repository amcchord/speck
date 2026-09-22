import SwiftUI

/// Displays only the server's opted-in, short-lived frame; never persists it.
struct ScreenPreviewView: View {
  @Environment(SpeckSession.self) private var session
  @Environment(\.scenePhase) private var phase
  let device: Device
  @State private var frame: UIImage?
  @State private var captured: Date?
  @State private var status = "Waiting for a recent frame"
  @State private var busy = false
  @State private var error: String?
  var enabled: Bool { device.raw["preview"]["enabled"].bool }
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Toggle("Live screen preview", isOn: Binding(get: { enabled }, set: { updatePolicy($0) }))
        .disabled(busy || !device.approved || device.revoked)
      if enabled {
        if let frame, phase == .active {
          Image(uiImage: frame).resizable().scaledToFit()
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .accessibilityLabel("Recent screen of \(device.name)")
          if let captured {
            Text("Captured \(captured.formatted(date: .omitted, time: .shortened))").font(.caption)
              .foregroundStyle(.secondary)
          }
        } else {
          Label(status, systemImage: "display").font(.subheadline).foregroundStyle(.secondary)
        }
        Text(
          "Desktop frames refresh about every 10 seconds. Disable this per machine to stop capture."
        ).font(.caption).foregroundStyle(.secondary)
      }
      if let error { InlineError(text: error) }
    }.padding(.vertical, 4)
      .sessionTask(session, id: "\(phase)-\(enabled)") {
        guard phase == .active, enabled, !session.demo else {
          frame = nil
          return
        }
        while !Task.isCancelled {
          do {
            let (data, response) = try await session.send(
              origin: SpeckSession.validatedOrigin(session.server),
              path: "/devices/\(device.id)/preview", method: "GET", body: nil)
            if !Task.isCancelled {
              frame = UIImage(data: data)
              captured = response.value(forHTTPHeaderField: "X-Speck-Captured-At").flatMap(
                Double.init
              ).map(Date.init(timeIntervalSince1970:))
              status = "Waiting for a recent frame"
            }
          } catch {
            frame = nil
            status = "No recent frame. Check the desktop helper."
          }
          do { try await Task.sleep(for: .seconds(10)) } catch { break }
        }
      }.onDisappear { frame = nil }
  }
  private func updatePolicy(_ value: Bool) {
    busy = true
    error = nil
    session.perform {
      do {
        _ = try await session.request(
          "/devices/\(device.id)/preview-policy", method: "PUT",
          body: .object(["enabled": .bool(value)]))
        if !value { frame = nil }
        await session.refresh()
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}
