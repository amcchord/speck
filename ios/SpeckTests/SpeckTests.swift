import XCTest

@testable import Speck

@MainActor final class SpeckTests: XCTestCase {
  func testServerOriginRequiresHTTPSAndRejectsCredentialURLs() throws {
    XCTAssertEqual(
      try SpeckSession.validatedOrigin("https://speckrmm.com/").absoluteString,
      "https://speckrmm.com")
    for value in [
      "http://speckrmm.com", "https://user:password@speckrmm.com", "https://speckrmm.com/api",
      "https://speckrmm.com?redirect=evil", "https://speckrmm.com/#fleet", "javascript:alert(1)",
      "https://",
    ] { XCTAssertThrowsError(try SpeckSession.validatedOrigin(value), value) }
  }
  func testSelfHostedOriginPreservesPort() throws {
    XCTAssertEqual(
      try SpeckSession.validatedOrigin(" https://rmm.example.com:8443 ").absoluteString,
      "https://rmm.example.com:8443")
  }
  func testNumericSQLiteFlagsAndBooleanFlags() throws {
    let raw = try JSONDecoder().decode(
      JSON.self, from: Data("{\"approved\":1,\"archived\":0,\"online\":true}".utf8))
    let device = Device(raw: raw)
    XCTAssertTrue(device.approved)
    XCTAssertFalse(device.archived)
    XCTAssertTrue(device.online)
    XCTAssertTrue(device.manageable)
  }
  func testRestoredIdentityRemainsSeparate() throws {
    let d = Device(
      raw: .object([
        "id": .string("restored-id"), "restored_from": .string("original-id"),
        "approved": .bool(false), "online": .bool(true),
      ]))
    XCTAssertEqual(d.id, "restored-id")
    XCTAssertTrue(d.restored)
    XCTAssertFalse(d.manageable)
    XCTAssertEqual(d.status, "Needs approval")
  }
  func testArchivedOnlineDeviceCannotBeManaged() {
    XCTAssertFalse(
      Device(
        raw: .object(["online": .bool(true), "approved": .bool(true), "archived": .bool(true)])
      ).manageable)
  }
  func testMissingTelemetryIsSafe() {
    let d = Device(raw: .object(["id": .string("machine")]))
    XCTAssertEqual(d.cpu, 0)
    XCTAssertEqual(d.address, "No address")
    XCTAssertEqual(d.telemetry["services"].array, [])
  }
  func testTerminalJobStatusesIncludeUnknownAndCancelled() {
    for state in ["complete", "failed", "unknown", "cancelled", "expired"] {
      XCTAssertTrue(Job(raw: .object(["status": .string(state)])).finished)
    }
    XCTAssertFalse(Job(raw: .object(["status": .string("queued")])).finished)
  }
  func testJSONRoundTripPreservesNullAndTypes() throws {
    let data = Data("{\"null\":null,\"flags\":[true,1,\"one\"],\"nested\":{\"value\":42}}".utf8)
    let value = try JSONDecoder().decode(JSON.self, from: data)
    XCTAssertEqual(try JSONDecoder().decode(JSON.self, from: JSONEncoder().encode(value)), value)
    XCTAssertTrue(value["null"].isNull)
  }
  func testRevokedDeviceCannotBeManaged() {
    let d = Device(
      raw: .object(["online": .bool(true), "approved": .bool(true), "revoked": .number(1)]))
    XCTAssertFalse(d.manageable)
    XCTAssertEqual(d.status, "Revoked")
  }
  func testNetworkReportsSupportBothPlatforms() {
    let windows: JSON = .object([
      "DestinationPrefix": .string("0.0.0.0/0"), "NextHop": .string("10.0.0.1"),
      "InterfaceAlias": .string("Ethernet"),
    ])
    let linux: JSON = .object([
      "dst": .string("default"), "gateway": .string("10.0.0.1"), "dev": .string("eth0"),
    ])
    XCTAssertEqual(NetworkReport.destination(windows), "0.0.0.0/0")
    XCTAssertEqual(NetworkReport.gateway(linux), "10.0.0.1")
    XCTAssertEqual(NetworkReport.interface(windows), "Ethernet")
    let dns: JSON = .object([
      "dns_servers": .array([
        .string("1.1.1.1"),
        .object(["ServerAddresses": .array([.string("1.1.1.1"), .string("9.9.9.9")])]),
      ])
    ])
    XCTAssertEqual(NetworkReport.dnsServers(dns), ["1.1.1.1", "9.9.9.9"])
  }
  func testDemoRejectsMutations() {
    XCTAssertThrowsError(try DemoData.response("/devices/demo/jobs", method: "POST"))
  }
}
