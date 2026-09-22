import XCTest

@testable import Speck

/// Deterministic delays at the HTTP boundary, with no network or real Keychain writes.
private actor DelayedServer {
  typealias Reply = (Data, URLResponse)
  struct Pending {
    let request: URLRequest
    let continuation: CheckedContinuation<Reply, Error>
  }
  private var holds: [String: XCTestExpectation] = [:]
  private var pending: [String: Pending] = [:]
  private(set) var requests: [URLRequest] = []

  func hold(_ path: String, user: String, arrived: XCTestExpectation) {
    holds[path + "|" + user] = arrived
  }
  private func user(_ request: URLRequest) -> String {
    if request.url?.path == "/api/auth/login",
      let body = request.httpBody,
      let value = try? JSONDecoder().decode(JSON.self, from: body)
    {
      return value["username"].string
    }
    return (request.value(forHTTPHeaderField: "Cookie") ?? "").replacingOccurrences(
      of: "speck_session=cookie-", with: "")
  }
  func load(_ request: URLRequest) async throws -> Reply {
    requests.append(request)
    let key = (request.url?.path ?? "") + "|" + user(request)
    if let arrived = holds.removeValue(forKey: key) {
      return try await withCheckedThrowingContinuation { continuation in
        pending[key] = Pending(request: request, continuation: continuation)
        arrived.fulfill()
      }
    }
    return reply(request)
  }
  func release(_ path: String, user: String, status: Int = 200) {
    guard let held = pending.removeValue(forKey: path + "|" + user) else { return }
    held.continuation.resume(returning: reply(held.request, status: status))
  }
  func count(_ path: String) -> Int { requests.filter { $0.url?.path == path }.count }
  private func reply(_ request: URLRequest, status: Int = 200) -> Reply {
    let name = user(request)
    var headers = ["Content-Type": "application/json"]
    var body = "{}"
    switch request.url?.path {
    case "/api/auth/login", "/api/auth/me":
      headers["Set-Cookie"] = "speck_session=cookie-\(name); Path=/; Secure; HttpOnly"
      body = "{\"username\":\"\(name)\",\"csrf\":\"csrf-\(name)\",\"role\":\"admin\"}"
    case "/api/devices": body = "[{\"id\":\"\(name)\",\"hostname\":\"\(name)\"}]"
    case "/api/alerts": body = "{\"items\":[{\"id\":\"\(name)\"}]}"
    case "/api/recovery/runs": body = "[]"
    case "/api/jobs/pending": body = "{\"id\":\"pending\",\"status\":\"queued\"}"
    default: break
    }
    return (
      Data(body.utf8),
      HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
    )
  }
}

@MainActor final class SessionIsolationTests: XCTestCase {
  private var saved: SessionRecord?
  private func client(_ server: DelayedServer) -> SpeckSession {
    SpeckSession(
      persistence: SessionPersistence(
        load: { self.saved }, save: { self.saved = $0 }, clear: { self.saved = nil }),
      dataLoader: { try await server.load($0) },
      downloadLoader: { request in
        let (data, response) = try await server.load(request)
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(
          UUID().uuidString)
        try data.write(to: temporary)
        return (temporary, response)
      },
      uploadLoader: { request, _ in try await server.load(request) })
  }
  private func login(_ session: SpeckSession, _ name: String) async throws {
    try await session.signIn(
      server: "https://rmm.example.com", username: name, password: "fixture", code: "")
  }
  private func assertBob(
    _ session: SpeckSession, file: StaticString = #filePath, line: UInt = #line
  ) {
    XCTAssertEqual(session.username, "bob", file: file, line: line)
    XCTAssertEqual(session.record?.csrf, "csrf-bob", file: file, line: line)
    XCTAssertEqual(saved?.username, "bob", file: file, line: line)
    XCTAssertEqual(session.devices.map(\.id), ["bob"], file: file, line: line)
    XCTAssertEqual(session.alerts.map(\.id), ["bob"], file: file, line: line)
    XCTAssertFalse(session.refreshing, file: file, line: line)
    XCTAssertNil(session.error, file: file, line: line)
  }
  private func expectCancellation<T>(_ task: Task<T, Error>) async {
    do {
      _ = try await task.value
      XCTFail("Old operation should be cancelled")
    } catch { XCTAssertTrue(error is CancellationError, "Unexpected error: \(error)") }
  }
  func testLate401CannotClearNewLogin() async throws {
    let server = DelayedServer()
    let controlled = client(server)
    try await login(controlled, "alice")
    let arrived = expectation(description: "old authenticated request")
    await server.hold("/api/late", user: "alice", arrived: arrived)
    let old = Task { try await controlled.request("/late") }
    await fulfillment(of: [arrived], timeout: 3)
    await controlled.signOut()
    try await login(controlled, "bob")
    await server.release("/api/late", user: "alice", status: 401)
    await expectCancellation(old)
    assertBob(controlled)
  }
  func testRefreshHeldAtRecoveryCannotPublishOldInventory() async throws {
    let server = DelayedServer()
    let arrived = expectation(description: "old recovery fetch")
    let session = client(server)
    await server.hold("/api/recovery/runs", user: "alice", arrived: arrived)
    let old = Task { try await login(session, "alice") }
    await fulfillment(of: [arrived], timeout: 3)
    await session.signOut()
    try await login(session, "bob")
    await server.release("/api/recovery/runs", user: "alice")
    try await old.value
    assertBob(session)
  }
  func testLateRestoreCannotOverwriteNewCredentials() async throws {
    let server = DelayedServer()
    saved = SessionRecord(
      server: "https://rmm.example.com", cookie: "cookie-alice", expires: .distantFuture,
      csrf: "old-csrf", username: "alice", role: "viewer")
    let controlled = client(server)
    let arrived = expectation(description: "restore auth check")
    await server.hold("/api/auth/me", user: "alice", arrived: arrived)
    let old = Task { await controlled.restore() }
    await fulfillment(of: [arrived], timeout: 3)
    try await login(controlled, "bob")
    await server.release("/api/auth/me", user: "alice")
    await old.value
    assertBob(controlled)
    XCTAssertFalse(controlled.restoring)
  }
  func testLogoutClearsImmediatelyAndLateCompletionPreservesNewLogin() async throws {
    let server = DelayedServer()
    let arrived = expectation(description: "logout response held")
    let session = client(server)
    try await login(session, "alice")
    let oldStore = session.webData
    await server.hold("/api/auth/logout", user: "alice", arrived: arrived)
    let logout = Task { await session.signOut() }
    await fulfillment(of: [arrived], timeout: 3)
    XCTAssertFalse(session.signedIn)
    XCTAssertNil(saved)
    XCTAssertFalse(oldStore === session.webData)
    try await login(session, "bob")
    await server.release("/api/auth/logout", user: "alice", status: 401)
    await logout.value
    assertBob(session)
  }
  func testEarlierLoginCannotReplaceLaterLogin() async throws {
    let server = DelayedServer()
    let arrived = expectation(description: "old login held")
    let session = client(server)
    await server.hold("/api/auth/login", user: "alice", arrived: arrived)
    let old = Task { try await login(session, "alice") }
    await fulfillment(of: [arrived], timeout: 3)
    try await login(session, "bob")
    await server.release("/api/auth/login", user: "alice")
    await expectCancellation(old)
    assertBob(session)
  }
  func testOperationScopeRejectsRequestsUsingAnotherLogin() async throws {
    let server = DelayedServer()
    let controlled = client(server)
    try await login(controlled, "alice")
    let original = controlled.generation
    await controlled.signOut()
    try await login(controlled, "bob")
    do {
      try await controlled.withSession(generation: original) {
        _ = try await controlled.request("/must-not-run", method: "POST")
      }
      XCTFail("A continued operation must not use the new account's credentials")
    } catch { XCTAssertTrue(error is CancellationError) }
    let count = await server.count("/api/must-not-run")
    XCTAssertEqual(count, 0)
    assertBob(controlled)
  }
  func testLateTransfer401CannotClearNewLogin() async throws {
    for upload in [false, true] {
      let server = DelayedServer()
      let controlled = client(server)
      try await login(controlled, "alice")
      let path = upload ? "/api/devices/test/files/upload" : "/api/transfers/test/file"
      let arrived = expectation(description: "transfer response held")
      await server.hold(path, user: "alice", arrived: arrived)
      let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      try Data("fixture".utf8).write(to: file)
      defer { try? FileManager.default.removeItem(at: file) }
      let old = Task {
        if upload {
          _ = try await controlled.uploadFile(
            deviceID: "test", destination: "/tmp/test", file: file)
        } else {
          _ = try await controlled.downloadFile(id: "test", name: "fixture")
        }
      }
      await fulfillment(of: [arrived], timeout: 3)
      await controlled.signOut()
      try await login(controlled, "bob")
      await server.release(path, user: "alice", status: 401)
      await expectCancellation(old)
      assertBob(controlled)
    }
  }
  func testPausedMultiStepOperationCannotSwitchAccounts() async throws {
    let server = DelayedServer()
    let controlled = client(server)
    try await login(controlled, "alice")
    let reachedPause = expectation(description: "first step complete")
    var resume: CheckedContinuation<Void, Never>?
    var cancelled = false
    let operation = controlled.perform {
      do {
        _ = try await controlled.request("/first-step")
        await withCheckedContinuation { continuation in
          resume = continuation
          reachedPause.fulfill()
        }
        _ = try await controlled.request("/must-not-run", method: "POST")
      } catch { cancelled = error is CancellationError }
    }
    await fulfillment(of: [reachedPause], timeout: 3)
    await controlled.signOut()
    try await login(controlled, "bob")
    resume?.resume()
    await operation.value
    let count = await server.count("/api/must-not-run")
    XCTAssertTrue(cancelled)
    XCTAssertEqual(count, 0)
    assertBob(controlled)
  }
  func testCurrent401StillSignsOut() async throws {
    let server = DelayedServer()
    let arrived = expectation(description: "current request held")
    let session = client(server)
    try await login(session, "alice")
    await server.hold("/api/late", user: "alice", arrived: arrived)
    let request = Task { try await session.request("/late") }
    await fulfillment(of: [arrived], timeout: 3)
    await server.release("/api/late", user: "alice", status: 401)
    do {
      _ = try await request.value
      XCTFail("Expected authentication error")
    } catch {}
    XCTAssertFalse(session.signedIn)
    XCTAssertNil(saved)
    XCTAssertTrue(session.devices.isEmpty)
  }
}

@MainActor final class PasskeySessionTests: XCTestCase {
  func testBase64URLRoundTrip() {
    let bytes = Data((0...255).map(UInt8.init))
    XCTAssertEqual(Data(base64URL: bytes.base64URL), bytes)
    XCTAssertFalse(bytes.base64URL.contains("="))
  }
  func testCustomServerCannotRequestTheOfficialDomainsPasskey() async throws {
    let session = SpeckSession(
      persistence: SessionPersistence(load: { nil }, save: { _ in XCTFail("No session may be stored") }, clear: {}),
      dataLoader: { request in
        XCTAssertEqual(request.url?.host, "custom.example.com")
        return (Data("{\"challenge_id\":\"fixture\",\"publicKey\":{\"rpId\":\"speckrmm.com\"}}".utf8),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: [:])!)
      })
    do {
      try await session.signInWithPasskey(server: "https://custom.example.com") { _ in
        XCTFail("An unrelated server must never invoke the official domain's credential provider")
        return .null
      }
      XCTFail("Mismatched RP must fail")
    } catch { XCTAssertTrue(error.localizedDescription.contains("domain does not match")) }
  }
  func testAlternatePortCannotRequestTheOfficialDomainsPasskey() async throws {
    let session = SpeckSession(
      persistence: SessionPersistence(load: { nil }, save: { _ in XCTFail("No session may be stored") }, clear: {}),
      dataLoader: { request in
        return (Data("{\"challenge_id\":\"fixture\",\"publicKey\":{\"rpId\":\"speckrmm.com\"}}".utf8),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: [:])!)
      })
    do {
      try await session.signInWithPasskey(server: "https://speckrmm.com:8443") { _ in
        XCTFail("An alternate origin must not invoke the official provider")
        return .null
      }
      XCTFail("Alternate origin must fail")
    } catch { XCTAssertTrue(error.localizedDescription.contains("domain does not match")) }
  }
  func testNativeCeremonyCannotFinishAfterSigningOut() async throws {
    var finish: CheckedContinuation<JSON, Error>?
    let arrived = expectation(description: "native passkey sheet")
    let session = SpeckSession(
      persistence: SessionPersistence(load: { nil }, save: { _ in XCTFail("No stale login may be saved") }, clear: {}),
      dataLoader: { request in
        XCTAssertEqual(request.url?.path, "/api/auth/passkeys/options")
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        return (Data("{\"challenge_id\":\"fixture\",\"publicKey\":{\"rpId\":\"speckrmm.com\"}}".utf8),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: [:])!)
      })
    let login = Task {
      try await session.signInWithPasskey(server: "https://speckrmm.com") { _ in
        try await withCheckedThrowingContinuation { continuation in finish = continuation; arrived.fulfill() }
      }
    }
    await fulfillment(of: [arrived], timeout: 3)
    await session.signOut()
    finish?.resume(returning: .object([:]))
    do { try await login.value; XCTFail("Late passkey response must be canceled") }
    catch { XCTAssertTrue(error is CancellationError) }
    XCTAssertFalse(session.signedIn)
  }
  func testNativePasskeyLoginStoresOnlyServerSession() async throws {
    var saved: SessionRecord?
    let session = SpeckSession(
      persistence: SessionPersistence(load: { nil }, save: { saved = $0 }, clear: { saved = nil }),
      dataLoader: { request in
        let path = request.url!.path
        var body = "{}"
        var headers = [String: String]()
        if path == "/api/auth/passkeys/options" { body = "{\"challenge_id\":\"fixture\",\"publicKey\":{\"rpId\":\"speckrmm.com\"}}" }
        if path == "/api/auth/passkeys/verify" {
          let sent = try JSONDecoder().decode(JSON.self, from: request.httpBody!)
          XCTAssertEqual(sent["challenge_id"].string, "fixture")
          XCTAssertEqual(sent["credential"]["id"].string, "synthetic")
          XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
          body = "{\"username\":\"Alex\",\"csrf\":\"synthetic-csrf\",\"role\":\"viewer\"}"
          headers["Set-Cookie"] = "speck_session=synthetic-session; Path=/; Secure; HttpOnly"
        }
        if path == "/api/devices" { body = "[]" }
        if path == "/api/alerts" { body = "{\"items\":[]}" }
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: headers)!)
      })
    try await session.signInWithPasskey(server: "https://speckrmm.com") { _ in .object(["id": .string("synthetic")]) }
    XCTAssertEqual(saved?.username, "Alex")
    XCTAssertEqual(saved?.cookie, "synthetic-session")
    XCTAssertEqual(session.role, "viewer")
  }
}
