import SwiftUI
import UIKit

/// Script input must preserve literal quotes and hyphens.
struct CodeEditor: UIViewRepresentable {
  @Binding var text: String
  func makeCoordinator() -> Coordinator { Coordinator(text: $text) }
  func makeUIView(context: Context) -> UITextView {
    let view = UITextView()
    view.delegate = context.coordinator
    view.autocorrectionType = .no
    view.autocapitalizationType = .none
    view.smartQuotesType = .no
    view.smartDashesType = .no
    view.smartInsertDeleteType = .no
    view.spellCheckingType = .no
    view.keyboardType = .asciiCapable
    view.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
    view.backgroundColor = .clear
    view.accessibilityLabel = "Script"
    view.accessibilityIdentifier = "script-editor"
    view.adjustsFontForContentSizeCategory = true
    view.font = UIFontMetrics(forTextStyle: .body).scaledFont(
      for: .monospacedSystemFont(ofSize: 15, weight: .regular))
    let toolbar = UIToolbar()
    toolbar.items = [
      UIBarButtonItem(systemItem: .flexibleSpace),
      UIBarButtonItem(
        title: "Hide keyboard", style: .plain, target: context.coordinator,
        action: #selector(Coordinator.dismissInput)),
    ]
    toolbar.sizeToFit()
    view.inputAccessoryView = toolbar
    view.text = text
    return view
  }
  func updateUIView(_ view: UITextView, context: Context) {
    context.coordinator.text = $text
    if view.text != text { view.text = text }
  }
  final class Coordinator: NSObject, UITextViewDelegate {
    var text: Binding<String>
    init(text: Binding<String>) { self.text = text }
    @objc func dismissInput() { dismissKeyboard() }
    func textViewDidChange(_ textView: UITextView) { text.wrappedValue = textView.text }
  }
}
@MainActor func dismissKeyboard() {
  UIApplication.shared.sendAction(
    #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}
