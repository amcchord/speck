import SwiftUI

extension View {
  @MainActor func sessionRefreshable(
    _ session: SpeckSession, _ action: @escaping @MainActor @Sendable () async -> Void
  ) -> some View {
    let expected = session.generation
    return refreshable {
      await session.withSession(generation: expected) {
        guard session.isCurrent(expected) else { return }
        await action()
      }
    }
  }

  @MainActor func sessionTask(
    _ session: SpeckSession, _ action: @escaping @MainActor @Sendable () async -> Void
  ) -> some View {
    sessionTask(session, id: session.generation, action)
  }

  @MainActor func sessionTask<ID: Hashable & Sendable>(
    _ session: SpeckSession, id: ID,
    _ action: @escaping @MainActor @Sendable () async -> Void
  ) -> some View {
    let expected = session.generation
    return task(id: id) {
      await session.withSession(generation: expected) {
        guard session.isCurrent(expected) else { return }
        await action()
      }
    }
  }
}

extension Color {
  static let forest = Color(red: 25 / 255, green: 46 / 255, blue: 36 / 255)
  static let fern = Color(red: 56 / 255, green: 93 / 255, blue: 68 / 255)
  static let lime = Color(red: 220 / 255, green: 236 / 255, blue: 171 / 255)
  static let paper = Color(
    uiColor: UIColor {
      $0.userInterfaceStyle == .dark
        ? UIColor(red: 0.08, green: 0.12, blue: 0.10, alpha: 1)
        : UIColor(red: 244 / 255, green: 245 / 255, blue: 240 / 255, alpha: 1)
    })
  static let speckTint = Color(
    uiColor: UIColor {
      $0.userInterfaceStyle == .dark
        ? UIColor(red: 220 / 255, green: 236 / 255, blue: 171 / 255, alpha: 1)
        : UIColor(red: 56 / 255, green: 93 / 255, blue: 68 / 255, alpha: 1)
    })
  static let speckSurface = Color(uiColor: UIColor {
    $0.userInterfaceStyle == .dark
      ? UIColor(red: 25 / 255, green: 38 / 255, blue: 30 / 255, alpha: 1) : .white
  })
  static let speckInk = Color(uiColor: UIColor {
    $0.userInterfaceStyle == .dark
      ? UIColor(red: 235 / 255, green: 241 / 255, blue: 230 / 255, alpha: 1)
      : UIColor(red: 36 / 255, green: 56 / 255, blue: 44 / 255, alpha: 1)
  })
  static let speckLine = Color(uiColor: UIColor {
    $0.userInterfaceStyle == .dark
      ? UIColor(red: 62 / 255, green: 78 / 255, blue: 65 / 255, alpha: 1)
      : UIColor(red: 220 / 255, green: 227 / 255, blue: 216 / 255, alpha: 1)
  })
  static let speckWarning = Color(uiColor: UIColor {
    $0.userInterfaceStyle == .dark
      ? UIColor(red: 231 / 255, green: 190 / 255, blue: 111 / 255, alpha: 1)
      : UIColor(red: 121 / 255, green: 89 / 255, blue: 22 / 255, alpha: 1)
  })
  static let speckDanger = Color(uiColor: UIColor {
    $0.userInterfaceStyle == .dark
      ? UIColor(red: 246 / 255, green: 161 / 255, blue: 145 / 255, alpha: 1)
      : UIColor(red: 153 / 255, green: 62 / 255, blue: 50 / 255, alpha: 1)
  })
}
struct SpeckMark: View {
  var color: Color = .lime
  var body: some View {
    GeometryReader { geo in
      let size = min(geo.size.width, geo.size.height)
      ZStack {
        ForEach(0..<8) { ray in
          RoundedRectangle(cornerRadius: size * 0.047).fill(color)
            .frame(width: size * 0.094, height: size * 0.297)
            .offset(y: -size * 0.29).rotationEffect(.degrees(Double(ray) * 45))
        }
        Circle().fill(color).frame(width: size * 0.094, height: size * 0.094)
      }.frame(width: geo.size.width, height: geo.size.height)
    }.accessibilityHidden(true)
  }
}
struct SpeckWordmark: View {
  @Environment(\.colorScheme) private var colorScheme
  var light = false
  var body: some View {
    Image(light || colorScheme == .dark ? "WordmarkLight" : "Wordmark")
      .resizable().scaledToFit().frame(width: 172, height: 52)
      .accessibilityLabel("Speck")
  }
}
struct StatusPill: View {
  var text: String
  var tone: Color = .speckTint
  var body: some View {
    Text(titleCase(text)).font(.caption.weight(.semibold)).foregroundStyle(tone).padding(
      .horizontal, 9
    ).padding(.vertical, 5).background(tone.opacity(0.10), in: Capsule())
  }
}
struct MetricTile: View {
  var title: String
  var value: String
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.caption).foregroundStyle(.secondary)
      Text(value).font(.title2.weight(.semibold)).contentTransition(
        .numericText())
    }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(
      Color.speckSurface, in: RoundedRectangle(cornerRadius: 10))
  }
}
struct MetricPair<Content: View>: View {
  @Environment(\.dynamicTypeSize) private var typeSize
  @ViewBuilder var content: Content
  var body: some View {
    if typeSize.isAccessibilitySize {
      VStack(spacing: 12) { content }
    } else {
      HStack(spacing: 12) { content }
    }
  }
}
struct InlineError: View {
  var text: String
  var retry: (() -> Void)?
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label(text, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(Color.speckDanger)
      if let retry { Button("Try again", action: retry).font(.subheadline.weight(.semibold)) }
    }.padding().frame(maxWidth: .infinity, alignment: .leading).background(
      Color.speckDanger.opacity(0.07), in: RoundedRectangle(cornerRadius: 10)
    ).accessibilityElement(children: .combine)
  }
}
struct EmptyState: View {
  var title: String
  var symbol: String
  var detail: String
  var body: some View {
    ContentUnavailableView(title, systemImage: symbol, description: Text(detail))
  }
}
struct CodeBlock: View {
  var text: String
  var body: some View {
    ScrollView(.horizontal) {
      Text(text).font(.system(.footnote, design: .monospaced)).textSelection(.enabled).padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }.background(Color.forest, in: RoundedRectangle(cornerRadius: 12)).foregroundStyle(Color.lime)
  }
}
struct ActionLabel: View {
  var title: String
  var symbol: String? = nil
  var body: some View {
    HStack(spacing: 8) {
      if let symbol {
        Image(systemName: symbol).font(.system(size: 16, weight: .medium)).frame(width: 20)
      }
      Text(title).font(.subheadline.weight(.semibold))
    }.frame(maxWidth: .infinity).multilineTextAlignment(.center)
  }
}
struct PrimaryButton: ButtonStyle {
  @Environment(\.isEnabled) private var enabled
  var secondary = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.subheadline.weight(.semibold))
      .multilineTextAlignment(.center)
      .padding(.horizontal, 16).padding(.vertical, 10)
      .frame(maxWidth: .infinity, minHeight: 44)
      .foregroundStyle(secondary ? Color.speckTint : Color.white)
      .background(
        secondary ? Color.speckSurface : Color.fern,
        in: RoundedRectangle(cornerRadius: 8)
      )
      .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(secondary ? Color.speckLine : .clear) }
      .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.45)
      .contentShape(RoundedRectangle(cornerRadius: 8))
  }
}
