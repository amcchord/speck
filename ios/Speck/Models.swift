import Foundation

/// Heterogeneous endpoint telemetry is versioned by each installed agent.
indirect enum JSON: Codable, Sendable, Equatable {
  case object([String: JSON])
  case array([JSON])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode([String: JSON].self) {
      self = .object(v)
    } else {
      self = .array(try c.decode([JSON].self))
    }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .object(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .null: try c.encodeNil()
    }
  }
  subscript(_ key: String) -> JSON {
    if case .object(let o) = self { return o[key] ?? .null }
    return .null
  }
  var string: String {
    if case .string(let s) = self { return s }
    return ""
  }
  var number: Double {
    if case .number(let n) = self { return n }
    return 0
  }
  var bool: Bool {
    if case .bool(let b) = self { return b }
    return number != 0
  }
  var array: [JSON] {
    if case .array(let a) = self { return a }
    return []
  }
  var object: [String: JSON] {
    if case .object(let o) = self { return o }
    return [:]
  }
  var isNull: Bool { self == .null }
  var pretty: String {
    let e = JSONEncoder()
    e.outputFormatting = [.prettyPrinted, .sortedKeys]
    return (try? e.encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
  }
}

struct Device: Identifiable, Sendable, Hashable {
  let raw: JSON
  var id: String { raw["id"].string }
  var name: String { raw["label"].string.isEmpty ? raw["hostname"].string : raw["label"].string }
  var platform: String { raw["platform"].string }
  var windows: Bool { platform == "windows" }
  var online: Bool { raw["online"].bool }
  var approved: Bool { raw["approved"].bool }
  var archived: Bool { raw["archived"].bool }
  var revoked: Bool { raw["revoked"].bool }
  var manageable: Bool { online && approved && !archived && !revoked }
  var restored: Bool { !raw["restored_from"].isNull && !raw["restored_from"].string.isEmpty }
  var telemetry: JSON { raw["telemetry"] }
  var cpu: Double { telemetry["cpu_percent"].number }
  var memory: Double { telemetry["memory"]["usedPercent"].number }
  var os: String { telemetry["host"]["platform"].string }
  var site: String { raw["site"].string }
  var address: String {
    telemetry["network"]["interfaces"].array.flatMap { $0["addrs"].array }.map {
      $0["address"].string
    }.first(where: { !$0.hasPrefix("127.") && !$0.hasPrefix("::1") }) ?? "No address"
  }
  var status: String {
    archived
      ? "Archived"
      : revoked ? "Revoked" : !approved ? "Needs approval" : online ? "Online" : "Offline"
  }
  var lastSeen: Date { Date(timeIntervalSince1970: raw["last_seen"].number) }
  static func == (lhs: Device, rhs: Device) -> Bool { lhs.raw == rhs.raw }
  func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
struct Job: Identifiable, Sendable {
  let raw: JSON
  var id: String { raw["id"].string }
  var kind: String { raw["kind"].string }
  var status: String { raw["status"].string }
  var deviceID: String { raw["device_id"].string }
  var created: Date { Date(timeIntervalSince1970: raw["created"].number) }
  var finished: Bool { ["complete", "failed", "expired", "unknown", "cancelled"].contains(status) }
  var result: JSON { raw["result"] }
  var output: String {
    let text = [result["stdout"].string, result["stderr"].string, result["error"].string].filter {
      !$0.isEmpty
    }.joined(separator: "\n")
    return text.isEmpty ? (result.isNull ? "Waiting for the machine…" : result.pretty) : text
  }
}
struct AlertItem: Identifiable, Sendable {
  let raw: JSON
  var id: String { raw["id"].string }
  var title: String { raw["message"].string.isEmpty ? raw["title"].string : raw["message"].string }
  var deviceID: String { raw["device_id"].string }
  var acknowledged: Bool { !raw["acknowledged"].isNull }
  var resolved: Bool { !raw["resolved"].isNull }
}
struct SessionRecord: Codable, Sendable {
  var server: String
  var cookie: String
  var expires: Date
  var csrf: String
  var username: String
  var role: String
}
struct SpeckError: LocalizedError, Equatable {
  var message: String
  var errorDescription: String? { message }
}
func formattedBytes(_ number: Double) -> String {
  ByteCountFormatter.string(fromByteCount: Int64(max(0, number)), countStyle: .file)
}
func titleCase(_ value: String) -> String {
  value.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " ")
    .capitalized
}
