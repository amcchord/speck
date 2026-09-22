import SwiftUI
import UniformTypeIdentifiers

struct FilesView: View {
  @Environment(SpeckSession.self) private var session
  var device: Device
  @State private var path = ""
  @State private var entries: [JSON] = []
  @State private var busy = false
  @State private var error: String?
  @State private var loaded = false
  @State private var download: URL?
  @State private var importing = false
  @State private var pendingUpload: URL?
  @State private var uploadConfirm = false
  @State private var message: String?
  var body: some View {
    List {
      Section {
        HStack {
          TextField("Absolute directory path", text: $path).font(.subheadline.monospaced())
            .textInputAutocapitalization(.never).autocorrectionDisabled().onSubmit { browse() }
          Button {
            browse()
          } label: {
            Image(systemName: "arrow.right.circle.fill")
          }.accessibilityLabel("Open folder").disabled(busy || !device.manageable)
        }
        if busy { ProgressView("Working on \(device.name)…") }
        if let error { InlineError(text: error) }
        if let message {
          Label(message, systemImage: "checkmark.circle").font(.footnote).foregroundStyle(
            Color.speckTint)
        }
        if let download {
          ShareLink(item: download) {
            Label("Save or share downloaded file", systemImage: "square.and.arrow.up")
          }
        }
      }
      Section("\(entries.count) items") {
        ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
          Button {
            if entry["directory"].bool {
              path = entry["path"].string
              browse()
            } else {
              fetch(entry)
            }
          } label: {
            HStack(spacing: 12) {
              Image(systemName: entry["directory"].bool ? "folder.fill" : "doc").foregroundStyle(
                Color.speckTint
              ).frame(width: 28)
              VStack(alignment: .leading, spacing: 5) {
                Text(entry["name"].string).foregroundStyle(.primary)
                Text(entry["directory"].bool ? "Folder" : formattedBytes(entry["size"].number))
                  .font(.caption).foregroundStyle(.secondary)
              }
              Spacer()
              Image(systemName: entry["directory"].bool ? "chevron.right" : "arrow.down.circle")
                .foregroundStyle(.secondary)
            }.padding(.vertical, 4)
          }.disabled(busy)
        }
      }
      if loaded && entries.isEmpty && error == nil {
        EmptyState(
          title: "Empty folder", symbol: "folder", detail: "Upload a file or open another path.")
      }
    }.scrollContentBackground(.hidden).background(Color.paper).navigationTitle("Files")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        Button {
          importing = true
        } label: {
          Image(systemName: "square.and.arrow.up")
        }.disabled(busy || !device.manageable || !loaded).accessibilityLabel("Upload a file")
      }
      .task {
        path = device.windows ? "C:\\" : "/"
        browse()
      }
      .fileImporter(isPresented: $importing, allowedContentTypes: [.data]) { result in
        switch result {
        case .success(let url):
          pendingUpload = url
          uploadConfirm = true
        case .failure(let error): self.error = error.localizedDescription
        }
      }
      .confirmationDialog(
        "Upload to \(device.name)?", isPresented: $uploadConfirm, titleVisibility: .visible
      ) {
        Button("Upload file") { upload() }
      } message: {
        Text(
          "\(pendingUpload?.lastPathComponent ?? "File") will be added to \(path). Existing files will not be overwritten."
        )
      }
      .onDisappear {
        if let download {
          try? FileManager.default.removeItem(at: download.deletingLastPathComponent())
        }
      }
  }
  func browse() {
    busy = true
    error = nil
    message = nil
    Task {
      do {
        let started = try await session.submit(
          device: device, kind: "files.list", payload: .object(["path": .string(path)]))
        let result = try await session.waitForJob(started.id)
        entries = result.result["entries"].array
        if !result.result["path"].string.isEmpty { path = result.result["path"].string }
        loaded = true
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
  func fetch(_ entry: JSON) {
    busy = true
    error = nil
    Task {
      do {
        let transfer = try await session.request(
          "/devices/\(device.id)/files/download", method: "POST",
          body: .object(["path": entry["path"]]))
        _ = try await session.waitForJob(transfer["job_id"].string)
        let downloaded = try await session.downloadFile(
          id: transfer["id"].string, name: entry["name"].string)
        if let download {
          try? FileManager.default.removeItem(at: download.deletingLastPathComponent())
        }
        download = downloaded
        message = "Downloaded and SHA-256 verified."
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
  func upload() {
    guard let url = pendingUpload else { return }
    let scoped = url.startAccessingSecurityScopedResource()
    busy = true
    error = nil
    Task {
      defer {
        if scoped { url.stopAccessingSecurityScopedResource() }
        busy = false
        pendingUpload = nil
      }
      do {
        let separator = device.windows ? "\\" : "/"
        let destination =
          path.hasSuffix(separator)
          ? path + url.lastPathComponent : path + separator + url.lastPathComponent
        let transfer = try await session.uploadFile(
          deviceID: device.id, destination: destination, file: url)
        _ = try await session.waitForJob(transfer["job_id"].string)
        message = "Upload complete."
      } catch { self.error = error.localizedDescription }
    }
  }
}
