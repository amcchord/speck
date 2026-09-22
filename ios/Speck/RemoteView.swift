import SwiftUI
import WebKit

struct RemoteView: View {
  @Environment(SpeckSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  var device: Device
  @State private var ready = false
  @State private var controls = false
  @State private var error: String?
  var body: some View {
    NavigationStack {
      Group {
        if session.demo {
          EmptyState(
            title: "Remote workspace", symbol: "display",
            detail: "Sign in to your Speck server to control a machine.")
        } else if let error {
          InlineError(text: error).padding()
        } else if ready {
          RemoteWebView(
            url: URL(string: session.server + "/#remote/" + device.id)!, dataStore: session.webData,
            controls: controls, error: $error)
        } else {
          ProgressView("Connecting securely…")
        }
      }.navigationTitle(device.name).navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
          ToolbarItem(placement: .primaryAction) {
            Button {
              controls.toggle()
            } label: {
              Image(systemName: "slider.horizontal.3")
            }.accessibilityLabel(controls ? "Hide remote controls" : "Show remote controls")
              .disabled(!ready || session.demo)
          }
        }
        .task {
          await session.remoteCookies()
          ready = true
        }
    }
  }
}
struct RemoteWebView: UIViewRepresentable {
  let url: URL
  let dataStore: WKWebsiteDataStore
  var controls: Bool
  @Binding var error: String?
  func makeCoordinator() -> Coordinator { Coordinator(origin: url, error: $error) }
  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = dataStore
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    // Native navigation owns dismissal/fullscreen; preserve all remote controls.
    let css = """
      .remote-back,#desktop-launch,#fullscreen,.remote-header h1,.remote-header .wordmark{display:none!important}
      .remote-header{min-height:30px;padding:4px 12px;gap:8px}
      .remote-header small{font-size:12px}
      .remote-controls,.remote-footer,#remote-ai{display:none!important}
      html.speck-controls #remote-ai{display:block!important}
      html.speck-controls .remote-controls{display:flex!important;flex-wrap:nowrap;overflow-x:auto;padding:8px;gap:8px}
      .remote-controls>*{flex-shrink:0}
      .remote-controls .secondary,.remote-controls select,.remote-header .secondary,.remote-footer .secondary{min-height:44px;font-size:12px;padding:8px 12px;white-space:nowrap}
      .remote-controls select{padding-right:36px;max-width:none}
      html.speck-controls .remote-footer{display:grid!important;grid-template-columns:minmax(0,1fr) auto;padding:8px;gap:8px}
      .remote-footer #clipboard{width:100%;min-width:0;min-height:44px;margin:0;grid-column:1;font-size:16px}
      .remote-footer #paste{grid-column:2}
      .remote-footer #read-clipboard{grid-column:1;justify-self:start}
      .remote-footer>.check{grid-column:2;display:inline-flex;width:auto;justify-self:end;align-items:center;gap:8px;font-size:12px}
      .remote-footer .check input{width:18px;min-width:18px;height:18px;margin:0;flex:0 0 18px}
      """
    config.userContentController.addUserScript(
      WKUserScript(
        source:
          "const nativeStyle=document.createElement('style');nativeStyle.textContent=\(String(data: try! JSONEncoder().encode(css), encoding: .utf8)!);document.head.appendChild(nativeStyle);",
        injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    let view = WKWebView(frame: .zero, configuration: config)
    view.navigationDelegate = context.coordinator
    view.uiDelegate = context.coordinator
    view.isOpaque = false
    view.backgroundColor = UIColor(Color.paper)
    view.load(URLRequest(url: url))
    return view
  }
  func updateUIView(_ uiView: WKWebView, context: Context) {
    uiView.evaluateJavaScript(
      "document.documentElement.classList.toggle('speck-controls', \(controls ? "true" : "false"))",
      completionHandler: nil)
  }
  static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
    uiView.stopLoading()
    uiView.loadHTMLString("", baseURL: nil)
    uiView.navigationDelegate = nil
    uiView.uiDelegate = nil
  }
  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    let origin: URL
    @Binding var error: String?
    init(origin: URL, error: Binding<String?>) {
      self.origin = origin
      _error = error
    }
    func webView(
      _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
      decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
      guard let target = navigationAction.request.url else {
        decisionHandler(.cancel)
        return
      }
      if target.scheme == "about"
        || (target.scheme == "https" && target.host == origin.host && target.port == origin.port)
      {
        decisionHandler(.allow)
      } else {
        decisionHandler(.cancel)
      }
    }
    func webView(
      _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
      withError error: Error
    ) {
      if (error as NSError).code != NSURLErrorCancelled { self.error = error.localizedDescription }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
      if (error as NSError).code != NSURLErrorCancelled { self.error = error.localizedDescription }
    }
    func webView(
      _ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
      defaultText: String?, initiatedByFrame frame: WKFrameInfo,
      completionHandler: @escaping @MainActor (String?) -> Void
    ) {
      guard frame.securityOrigin.host == origin.host, let root = webView.window?.rootViewController
      else {
        completionHandler(nil)
        return
      }
      var presenter = root
      while let next = presenter.presentedViewController { presenter = next }
      let dialog = UIAlertController(
        title: "Type into remote machine", message: prompt, preferredStyle: .alert)
      dialog.addTextField { field in
        field.text = defaultText
        field.isSecureTextEntry = prompt.localizedCaseInsensitiveContains("password")
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.smartQuotesType = .no
        field.smartDashesType = .no
      }
      dialog.addAction(
        UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
      dialog.addAction(
        UIAlertAction(title: "Send", style: .default) { _ in
          completionHandler(dialog.textFields?.first?.text)
        })
      presenter.present(dialog, animated: true)
    }
    func webView(
      _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
      initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
      decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void
    ) {
      guard origin.protocol == "https", origin.host == self.origin.host, type == .microphone else {
        decisionHandler(.deny)
        return
      }
      decisionHandler(.prompt)
    }
  }
}
