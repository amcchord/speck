import CryptoKit
import Foundation
import Observation
import Security
import WebKit

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
enum SessionVault {
  private static let service = "com.speckrmm.ios.session"
  static func save(_ record: SessionRecord) throws {
    let data = try JSONEncoder().encode(record)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "current",
    ]
    let status = SecItemUpdate(
      query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var item = query
      item[kSecValueData as String] = data
      item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
      guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
        throw SpeckError(message: "Could not securely save this session.")
      }
    } else if status != errSecSuccess {
      throw SpeckError(message: "Could not securely save this session.")
    }
  }
  static func load() -> SessionRecord? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "current", kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return nil }
    return try? JSONDecoder().decode(SessionRecord.self, from: data)
  }
  static func clear() {
    SecItemDelete(
      [
        kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
        kSecAttrAccount as String: "current",
      ] as CFDictionary)
  }
}

@MainActor struct SessionPersistence {
  var load: () -> SessionRecord?
  var save: (SessionRecord) throws -> Void
  var clear: () -> Void
  static let keychain = SessionPersistence(
    load: SessionVault.load, save: SessionVault.save, clear: SessionVault.clear)
}

private enum SessionOperation {
  @TaskLocal static var generation: UUID?
}

@MainActor @Observable final class SpeckSession {
  private(set) var record: SessionRecord?
  private(set) var generation = UUID()
  var restoring = true
  var error: String?
  var devices: [Device] = []
  var alerts: [AlertItem] = []
  var lastRefresh: Date?
  var refreshing = false
  private var restoredSources: [String: String] = [:]
  private var recoveryRefreshed = Date.distantPast
  var demo = false
  private let transport: URLSession
  private let redirects = NoRedirects()
  private(set) var webData = WKWebsiteDataStore.nonPersistent()
  private let persistence: SessionPersistence
  private let dataLoader: @Sendable (URLRequest) async throws -> (Data, URLResponse)
  private let downloadLoader: @Sendable (URLRequest) async throws -> (URL, URLResponse)
  private let uploadLoader: @Sendable (URLRequest, URL) async throws -> (Data, URLResponse)
  var signedIn: Bool { record != nil || demo }
  var username: String { demo ? "Alex" : record?.username ?? "" }
  var role: String { demo ? "admin" : record?.role ?? "viewer" }
  var canManage: Bool { ["admin", "operator"].contains(role) }
  var server: String { record?.server ?? "https://speckrmm.com" }
  var activeAlerts: Int { alerts.filter { !$0.resolved }.count }
  init(
    persistence: SessionPersistence = .keychain,
    dataLoader: (@Sendable (URLRequest) async throws -> (Data, URLResponse))? = nil,
    downloadLoader: (@Sendable (URLRequest) async throws -> (URL, URLResponse))? = nil,
    uploadLoader: (@Sendable (URLRequest, URL) async throws -> (Data, URLResponse))? = nil
  ) {
    self.persistence = persistence
    let config = URLSessionConfiguration.ephemeral
    config.httpShouldSetCookies = false
    config.httpCookieStorage = nil
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = 30
    let transport = URLSession(configuration: config, delegate: redirects, delegateQueue: nil)
    self.transport = transport
    self.dataLoader = dataLoader ?? { try await transport.data(for: $0) }
    self.downloadLoader = downloadLoader ?? { try await transport.download(for: $0) }
    self.uploadLoader = uploadLoader ?? { try await transport.upload(for: $0, fromFile: $1) }
    #if DEBUG
      demo = ProcessInfo.processInfo.arguments.contains("--demo")
    #endif
  }
  static func validatedOrigin(_ text: String) throws -> URL {
    guard let c = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
      c.scheme == "https", let host = c.host, !host.isEmpty, c.user == nil, c.password == nil,
      c.query == nil, c.fragment == nil, c.path == "" || c.path == "/",
      let url = URL(
        string: "https://" + (c.percentEncodedHost ?? host) + (c.port.map { ":\($0)" } ?? ""))
    else {
      throw SpeckError(
        message: "Enter an HTTPS server address, such as https://speckrmm.com, without a path.")
    }
    return url
  }
  func isCurrent(_ expected: UUID) -> Bool {
    generation == expected && !Task.isCancelled
      && (SessionOperation.generation == nil || SessionOperation.generation == generation)
  }
  private func checkCurrent(_ expected: UUID) throws {
    guard isCurrent(expected) else { throw CancellationError() }
  }
  func withSession<T>(
    generation expected: UUID? = nil, _ operation: @MainActor () async throws -> T
  ) async rethrows -> T {
    try await SessionOperation.$generation.withValue(
      expected ?? SessionOperation.generation ?? generation
    ) {
      try await operation()
    }
  }
  @discardableResult
  func perform(_ operation: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
    let expected = SessionOperation.generation ?? generation
    return Task {
      await withSession(generation: expected) { await operation() }
    }
  }
  func restore() async {
    let expected = generation
    defer { if generation == expected { restoring = false } }
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("--sign-in-preview") { return }
    #endif
    if demo {
      await refresh()
      return
    }
    guard let saved = persistence.load(), saved.expires > Date(),
      (try? Self.validatedOrigin(saved.server)) != nil
    else {
      persistence.clear()
      return
    }
    record = saved
    do {
      let me = try await request("/auth/me")
      try checkCurrent(expected)
      record?.csrf = me["csrf"].string
      record?.role = me["role"].string
      if let record { try persistence.save(record) }
      await withSession(generation: expected) { await refresh() }
    } catch { if isCurrent(expected) { self.error = error.localizedDescription } }
  }
  func signIn(server: String, username: String, password: String, code: String) async throws {
    try checkCurrent(generation)
    let origin = try Self.validatedOrigin(server)
    clearSession()
    restoring = false
    let expected = generation
    let body: JSON = .object([
      "username": .string(username.trimmingCharacters(in: .whitespacesAndNewlines)),
      "password": .string(password),
      "code": .string(code.trimmingCharacters(in: .whitespacesAndNewlines)),
    ])
    let (data, response) = try await send(
      origin: origin, path: "/auth/login", method: "POST", body: body, authenticated: false)
    try checkCurrent(expected)
    try await completeSignIn(origin: origin, data: data, response: response, expected: expected)
  }
  func signInWithPasskey(
    server: String,
    authorize: @MainActor (JSON) async throws -> JSON = { try await PasskeyAuthorization.authorize($0) }
  ) async throws {
    try checkCurrent(generation)
    let origin = try Self.validatedOrigin(server)
    clearSession()
    restoring = false
    let expected = generation
    let (optionsData, _) = try await send(origin: origin, path: "/auth/passkeys/options", method: "POST", body: nil, authenticated: false)
    try checkCurrent(expected)
    let options = try JSONDecoder().decode(JSON.self, from: optionsData)
    let credential = try await authorize(options["publicKey"])
    try checkCurrent(expected)
    let (data, response) = try await send(origin: origin, path: "/auth/passkeys/verify", method: "POST",
      body: .object(["challenge_id": options["challenge_id"], "credential": credential]), authenticated: false)
    try await completeSignIn(origin: origin, data: data, response: response, expected: expected)
  }
  func addPasskey(name: String, password: String, code: String) async throws {
    try await withSession {
      let expected = generation
      let options = try await request("/access/passkeys/options", method: "POST",
        body: .object(["password": .string(password), "code": .string(code)]))
      try checkCurrent(expected)
      let credential = try await PasskeyAuthorization.authorize(options["publicKey"], register: true)
      try checkCurrent(expected)
      _ = try await request("/access/passkeys/verify", method: "POST",
        body: .object(["challenge_id": options["challenge_id"], "name": .string(name), "credential": credential]))
    }
  }
  private func completeSignIn(origin: URL, data: Data, response: HTTPURLResponse, expected: UUID) async throws {
    try checkCurrent(expected)
    let value = try JSONDecoder().decode(JSON.self, from: data)
    let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, pair in
      if let k = pair.key as? String, let v = pair.value as? String { result[k] = v }
    }
    guard
      let cookie = HTTPCookie.cookies(withResponseHeaderFields: headers, for: origin).first(where: {
        $0.name == "speck_session"
      }), !value["csrf"].string.isEmpty
    else { throw SpeckError(message: "The server did not create a valid session.") }
    let saved = SessionRecord(
      server: origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
      cookie: cookie.value, expires: cookie.expiresDate ?? Date().addingTimeInterval(43200),
      csrf: value["csrf"].string, username: value["username"].string,
      role: value["role"].string.isEmpty ? "viewer" : value["role"].string)
    try persistence.save(saved)
    record = saved
    error = nil
    await withSession(generation: expected) { await refresh() }
  }
  func send(origin: URL, path: String, method: String, body: JSON?, authenticated: Bool = true)
    async throws -> (Data, HTTPURLResponse)
  {
    let expected = generation
    try checkCurrent(expected)
    if authenticated {
      guard let record, try Self.validatedOrigin(record.server) == origin else {
        throw SpeckError(message: "Sign in to continue.")
      }
    }
    guard path.hasPrefix("/"), !path.hasPrefix("//"),
      let url = URL(
        string: origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
          + "/api" + path), url.host == origin.host
    else { throw SpeckError(message: "Invalid server request.") }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue(
      origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
      forHTTPHeaderField: "Origin")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      request.httpBody = try JSONEncoder().encode(body)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    if authenticated, let record {
      request.setValue("speck_session=" + record.cookie, forHTTPHeaderField: "Cookie")
      request.setValue(record.csrf, forHTTPHeaderField: "X-CSRF-Token")
    }
    let (data, response): (Data, URLResponse)
    do { (data, response) = try await dataLoader(request) } catch {
      try checkCurrent(expected)
      throw error
    }
    try checkCurrent(expected)
    guard let response = response as? HTTPURLResponse else {
      throw SpeckError(message: "Invalid response from the server.")
    }
    guard (200..<300).contains(response.statusCode) else {
      if response.statusCode == 401 && authenticated { clearSession() }
      let problem = try? JSONDecoder().decode(JSON.self, from: data)
      let detail = problem?["detail"].string ?? ""
      throw SpeckError(
        message: detail.isEmpty
          ? "The server returned HTTP \(response.statusCode). Try again." : detail)
    }
    return (data, response)
  }
  func request(_ path: String, method: String = "GET", body: JSON? = nil) async throws -> JSON {
    try checkCurrent(generation)
    if demo { return try DemoData.response(path, method: method) }
    let origin = try Self.validatedOrigin(server)
    let (data, _) = try await send(origin: origin, path: path, method: method, body: body)
    return data.isEmpty ? .null : try JSONDecoder().decode(JSON.self, from: data)
  }
  func refresh() async {
    await withSession { await refreshCurrentSession() }
  }
  private func refreshCurrentSession() async {
    let expected = generation
    guard signedIn, !refreshing, isCurrent(expected) else { return }
    refreshing = true
    defer { if generation == expected { refreshing = false } }
    do {
      async let fleet = request("/devices")
      async let inbox = request("/alerts?state=active&limit=100")
      let (f, a) = try await (fleet, inbox)
      try checkCurrent(expected)
      if canManage && Date().timeIntervalSince(recoveryRefreshed) > 300,
        let runs = try? await request("/recovery/runs")
      {
        try checkCurrent(expected)
        for member in runs.array.flatMap({ $0["state"]["members"].array }) {
          let restored = member["restored_device_id"].string
          let source = member["source_device_id"].string
          if !restored.isEmpty && !source.isEmpty { restoredSources[restored] = source }
        }
        recoveryRefreshed = Date()
      }
      try checkCurrent(expected)
      devices = f.array.map { raw in
        var values = raw.object
        if let source = restoredSources[raw["id"].string] {
          values["restored_from"] = .string(source)
        }
        return Device(raw: .object(values))
      }.sorted {
        $0.name.localizedStandardCompare($1.name) == .orderedAscending
      }
      alerts = a["items"].array.map(AlertItem.init)
      lastRefresh = Date()
      error = nil
    } catch { if isCurrent(expected) { self.error = error.localizedDescription } }
  }
  func clearSession() {
    generation = UUID()
    record = nil
    refreshing = false
    restoring = false
    error = nil
    restoredSources = [:]
    recoveryRefreshed = .distantPast
    devices = []
    alerts = []
    lastRefresh = nil
    persistence.clear()
    let previousWebData = webData
    webData = .nonPersistent()
    previousWebData.removeData(
      ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast,
      completionHandler: {})
  }
  func signOut() async {
    guard isCurrent(generation) else { return }
    // Capture the old credentials before invalidating all local operations.
    let logout = !demo ? try? fileRequest(path: "/auth/logout", method: "POST") : nil
    demo = false
    clearSession()
    if let logout { _ = try? await dataLoader(logout) }
    // A late logout response must never mutate a subsequent login.
  }
  func submit(device: Device, kind: String, payload: JSON, timeout: Double = 60) async throws -> Job
  {
    try await withSession {
      let expected = generation
      try checkCurrent(expected)
      let data = try await request(
        "/devices/\(device.id)/jobs", method: "POST",
        body: .object(["kind": .string(kind), "payload": payload, "timeout": .number(timeout)]))
      try checkCurrent(expected)
      return Job(raw: try await request("/jobs/" + data["id"].string))
    }
  }
  func waitForJob(_ id: String) async throws -> Job {
    try await withSession {
      let expected = generation
      for _ in 0..<100 {
        try checkCurrent(expected)
        let job = Job(raw: try await request("/jobs/" + id))
        if job.finished {
          guard job.status == "complete" else { throw SpeckError(message: job.output) }
          return job
        }
        try await Task.sleep(for: .seconds(2))
      }
      throw SpeckError(message: "This job is still running. Follow its progress in Jobs.")
    }
  }
  func remoteCookies() async throws {
    let expected = generation
    try checkCurrent(expected)
    let store = webData
    guard let record, let host = URL(string: record.server)?.host,
      let cookie = HTTPCookie(properties: [
        .domain: host, .path: "/", .name: "speck_session", .value: record.cookie, .secure: "TRUE",
        .expires: record.expires, HTTPCookiePropertyKey("HttpOnly"): "TRUE",
        HTTPCookiePropertyKey("SameSite"): "Strict",
      ])
    else { throw SpeckError(message: "Sign in to control this machine.") }
    await store.httpCookieStore.setCookie(cookie)
    guard isCurrent(expected) else {
      await store.httpCookieStore.deleteCookie(cookie)
      throw CancellationError()
    }
  }
  private func fileRequest(path: String, method: String = "GET") throws -> URLRequest {
    try checkCurrent(generation)
    guard let record else { throw SpeckError(message: "Sign in to transfer files.") }
    let origin = try Self.validatedOrigin(record.server)
    guard let url = URL(string: origin.absoluteString + "/api" + path), url.host == origin.host
    else { throw SpeckError(message: "Invalid transfer address.") }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue(record.server, forHTTPHeaderField: "Origin")
    request.setValue("speck_session=" + record.cookie, forHTTPHeaderField: "Cookie")
    request.setValue(record.csrf, forHTTPHeaderField: "X-CSRF-Token")
    request.timeoutInterval = 180
    return request
  }
  func downloadFile(id: String, name: String) async throws -> URL {
    let expected = generation
    try checkCurrent(expected)
    let (temporary, response) = try await downloadLoader(
      fileRequest(path: "/transfers/" + id + "/file"))
    defer { try? FileManager.default.removeItem(at: temporary) }
    try checkCurrent(expected)
    if (response as? HTTPURLResponse)?.statusCode == 401 { clearSession() }
    guard let http = response as? HTTPURLResponse, http.statusCode == 200,
      let expected = http.value(forHTTPHeaderField: "X-Content-SHA256"), expected.count == 64
    else { throw SpeckError(message: "The download could not be verified. Please try again.") }
    let file = try FileHandle(forReadingFrom: temporary)
    defer { try? file.close() }
    var digest = SHA256()
    while let chunk = try file.read(upToCount: 65536), !chunk.isEmpty { digest.update(data: chunk) }
    let actual = digest.finalize().map { String(format: "%02x", $0) }.joined()
    guard actual == expected.lowercased() else {
      throw SpeckError(message: "The file checksum did not match. The download was discarded.")
    }
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "speck-download-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete])
    let safeName =
      name.replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init)
      ?? "download"
    let destination = directory.appendingPathComponent(
      safeName == "." || safeName == ".." ? "download" : safeName)
    try FileManager.default.copyItem(at: temporary, to: destination)
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.complete], ofItemAtPath: destination.path)
    return destination
  }
  func uploadFile(deviceID: String, destination: String, file: URL) async throws -> JSON {
    let expected = generation
    try checkCurrent(expected)
    let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size <= 256 * 1024 * 1024 else {
      throw SpeckError(message: "Files must be 256 MiB or smaller.")
    }
    var query = URLComponents()
    query.queryItems = [
      URLQueryItem(name: "path", value: destination),
      URLQueryItem(name: "overwrite", value: "false"),
    ]
    var request = try fileRequest(
      path: "/devices/" + deviceID + "/files/upload?" + (query.percentEncodedQuery ?? ""),
      method: "POST")
    let boundary = "Speck-" + UUID().uuidString
    request.setValue(
      "multipart/form-data; boundary=" + boundary, forHTTPHeaderField: "Content-Type")
    let body = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString + ".multipart")
    FileManager.default.createFile(
      atPath: body.path, contents: nil, attributes: [.protectionKey: FileProtectionType.complete])
    defer { try? FileManager.default.removeItem(at: body) }
    let out = try FileHandle(forWritingTo: body)
    let input = try FileHandle(forReadingFrom: file)
    defer {
      try? out.close()
      try? input.close()
    }
    try out.write(
      contentsOf: Data(
        ("--" + boundary
          + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"upload\"\r\nContent-Type: application/octet-stream\r\n\r\n")
          .utf8))
    while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
      try out.write(contentsOf: chunk)
    }
    try out.write(contentsOf: Data(("\r\n--" + boundary + "--\r\n").utf8))
    try out.close()
    let (data, response) = try await uploadLoader(request, body)
    try checkCurrent(expected)
    if (response as? HTTPURLResponse)?.statusCode == 401 { clearSession() }
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
      let result = try? JSONDecoder().decode(JSON.self, from: data)
      throw SpeckError(
        message: result?["detail"].string.isEmpty == false
          ? result!["detail"].string : "Upload failed. Please try again.")
    }
    return try JSONDecoder().decode(JSON.self, from: data)
  }

}
