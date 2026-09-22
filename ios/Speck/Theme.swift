import SwiftUI

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
  var symbol: String
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Label(title, systemImage: symbol).font(.caption).foregroundStyle(.secondary)
      Text(value).font(.system(.title2, design: .rounded, weight: .semibold)).contentTransition(
        .numericText())
    }.frame(maxWidth: .infinity, alignment: .leading).padding(16).background(
      .background, in: RoundedRectangle(cornerRadius: 16))
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
      Label(text, systemImage: "exclamationmark.circle").font(.subheadline).foregroundStyle(.red)
      if let retry { Button("Try again", action: retry).font(.subheadline.weight(.semibold)) }
    }.padding().frame(maxWidth: .infinity, alignment: .leading).background(
      .red.opacity(0.07), in: RoundedRectangle(cornerRadius: 12)
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
  var symbol: String
  var body: some View {
    HStack(spacing: 8) {
      Image(systemName: symbol).font(.system(size: 16, weight: .semibold)).frame(width: 20)
      Text(title).font(.subheadline.weight(.semibold))
    }.frame(maxWidth: .infinity).multilineTextAlignment(.center)
  }
}
struct PrimaryButton: ButtonStyle {
  @Environment(\.isEnabled) private var enabled
  var secondary = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.headline)
      .padding(.horizontal, 16).padding(.vertical, 14)
      .frame(maxWidth: .infinity, minHeight: 48)
      .foregroundStyle(secondary ? Color.speckTint : Color.white)
      .background(
        secondary ? Color.speckTint.opacity(0.10) : Color.fern,
        in: RoundedRectangle(cornerRadius: 12)
      )
      .opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.45)
      .contentShape(RoundedRectangle(cornerRadius: 12))
  }
}
