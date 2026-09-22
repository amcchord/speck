import Foundation

enum DemoData {
  static let data: JSON = {
    guard let url = Bundle.main.url(forResource: "Preview", withExtension: "json"),
      let raw = try? Data(contentsOf: url),
      let json = try? JSONDecoder().decode(JSON.self, from: raw)
    else { return .null }
    return json
  }()
  static func response(_ path: String, method: String) throws -> JSON {
    guard method == "GET" else {
      throw SpeckError(message: "This is a read-only demo. Sign in to manage your machines.")
    }
    let route = path.split(separator: "?").first.map(String.init) ?? path
    switch route {
    case "/devices": return data["devices"]
    case "/alerts": return data["alerts"]
    case "/jobs": return data["jobs"]
    case "/recovery/plans": return data["plans"]
    case "/recovery/runs": return data["runs"]
    case "/templates": return data["templates"]
    case "/patches": return data["patches"]
    case "/schedules": return .array([])
    case "/access/me":
      return .object([
        "username": .string("Alex"), "role": .string("admin"), "mfa_enabled": .bool(true),
        "sessions": .number(2),
      ])
    default:
      if route.hasPrefix("/jobs/") {
        return data["jobs"].array.first(where: { $0["id"].string == String(route.dropFirst(6)) })
          ?? .null
      }
      throw SpeckError(message: "Not available in the read-only demo.")
    }
  }
}
