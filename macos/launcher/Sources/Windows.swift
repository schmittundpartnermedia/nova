import AppKit
import WebKit

final class StatusWindowController: NSWindowController {
    private let titleLabel = NSTextField(labelWithString: "NOVA")
    private let phaseLabel = NSTextField(labelWithString: "STARTING")
    private let detailLabel = NSTextField(wrappingLabelWithString: "NOVA wird vorbereitet…")

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 168),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )
        window.title = "NOVA"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.center()
        self.init(window: window)
        window.contentView = buildView()
    }

    func setPhase(_ phase: String, detail: String) {
        phaseLabel.stringValue = phase
        detailLabel.stringValue = detail
    }

    private func buildView() -> NSView {
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 168))
        titleLabel.font = NSFont.systemFont(ofSize: 22, weight: .semibold)
        titleLabel.alignment = .center
        phaseLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)
        phaseLabel.alignment = .center
        detailLabel.alignment = .center
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        phaseLabel.translatesAutoresizingMaskIntoConstraints = false
        detailLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(titleLabel)
        view.addSubview(phaseLabel)
        view.addSubview(detailLabel)
        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: view.topAnchor, constant: 28),
            titleLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            titleLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            phaseLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 10),
            phaseLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            phaseLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            detailLabel.topAnchor.constraint(equalTo: phaseLabel.bottomAnchor, constant: 16),
            detailLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            detailLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
        ])
        return view
    }
}

final class NovaWebWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private let startURL: URL

    init(startURL: URL) {
        self.startURL = startURL
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "NOVA"
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("NOVAMain")
        window.center()
        super.init(window: window)
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: window.contentView?.bounds ?? .zero, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        window.contentView = webView
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func loadUI() {
        webView.load(URLRequest(url: startURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
        window?.makeKeyAndOrderFront(nil)
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }
}
