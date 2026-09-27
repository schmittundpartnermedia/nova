import AppKit
import AVFoundation
import Speech
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
        window.level = .floating
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
    private let log: LogWriter?
    private var loadAttempts = 0
    private let maxLoadAttempts = 8
    var pageURL: URL { startURL }

    init(startURL: URL, log: LogWriter? = nil) {
        self.startURL = startURL
        self.log = log
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
        window.setAccessibilityElement(true)
        window.setAccessibilityRole(.window)
        window.setAccessibilityTitle("NOVA")
        super.init(window: window)
        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: window.contentView?.bounds ?? .zero, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setAccessibilityElement(true)
        webView.setAccessibilityRole(.group)
        webView.setAccessibilityLabel("NOVA")
        window.contentView = webView
        window.makeFirstResponder(webView)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func loadUI() {
        loadAttempts = 0
        // Chrome Web Speech ≠ WKWebView: Safari/WebKit needs Apple Speech TCC
        // before webkitSpeechRecognition can leave not-allowed.
        ensureSpeechRecognitionAccess { [weak self] in
            guard let self else { return }
            self.attemptLoad()
            self.window?.makeKeyAndOrderFront(nil)
        }
    }

    private func attemptLoad() {
        loadAttempts += 1
        log?.info("WebView laden", fields: ["attempt": String(loadAttempts), "url": startURL.absoluteString])
        webView.load(URLRequest(url: startURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 45))
    }

    private func retryLoadIfPossible() {
        guard loadAttempts < maxLoadAttempts else {
            log?.error("WebView konnte NOVA nach mehreren Versuchen nicht laden")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            self?.attemptLoad()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if isCancelledNavigation(error) { return }
        log?.warn("WebView-Navigation fehlgeschlagen", fields: ["error": error.localizedDescription])
        retryLoadIfPossible()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if isCancelledNavigation(error) { return }
        log?.warn("WebView-Provisional fehlgeschlagen", fields: ["error": error.localizedDescription])
        retryLoadIfPossible()
    }

    private func isCancelledNavigation(_ error: Error) -> Bool {
        (error as NSError).code == NSURLErrorCancelled
    }

    func startVoiceFromPage() {
        webView.evaluateJavaScript(
            """
            (function() {
              var start = document.querySelector('[aria-label="Voice Session starten"]');
              if (start) { start.click(); return "started"; }
              var stop = document.querySelector('[aria-label="Voice Session beenden"]');
              if (stop) return "already-active";
              return "missing";
            })()
            """
        ) { [weak self] result, error in
            self?.log?.info("Voice-Start", fields: [
                "result": (result as? String) ?? error?.localizedDescription ?? "nil",
            ])
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript(
            """
            (function() {
              var btn = document.querySelector('[aria-label="Voice Session starten"],[aria-label="Voice Session beenden"]');
              var text = (document.body && document.body.innerText) || "";
              return [
                location.protocol + "//" + location.host,
                String(window.isSecureContext === true),
                String(!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)),
                String(!!(window.SpeechRecognition || window.webkitSpeechRecognition)),
                btn ? btn.getAttribute("aria-label") : "none",
                btn ? String(btn.getAttribute("aria-pressed")) : "none",
                text.indexOf("Mikrofonzugriff wurde verweigert") !== -1 ? "denied-text" : "ok"
              ].join("|");
            })()
            """
        ) { [weak self] result, error in
            self?.log?.info("WebView-Voice-Status", fields: [
                "value": (result as? String) ?? error?.localizedDescription ?? "nil",
            ])
        }
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.canCreateDirectories = false
        panel.message = "Dateien für NOVA wählen"
        panel.prompt = "Hochladen"
        log?.info("WebView-Dateidialog", fields: [
            "multiple": parameters.allowsMultipleSelection ? "true" : "false",
            "directories": parameters.allowsDirectories ? "true" : "false",
        ])
        guard let host = webView.window ?? window else {
            completionHandler(nil)
            return
        }
        panel.beginSheetModal(for: host) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        let host = origin.host
        let local = host == "127.0.0.1" || host == "localhost" || host == "::1"
        guard local, type == .microphone || type == .cameraAndMicrophone else {
            log?.info("WebView-Mikrofon abgelehnt", fields: [
                "host": host,
                "type": String(describing: type),
            ])
            decisionHandler(.deny)
            return
        }
        requestMicrophoneAccess { [weak self] allowed in
            DispatchQueue.main.async {
                self?.log?.info("WebView-Mikrofonentscheidung", fields: [
                    "host": host,
                    "allowed": allowed ? "true" : "false",
                    "tcc": self?.microphoneTccLabel(AVCaptureDevice.authorizationStatus(for: .audio)) ?? "unknown",
                ])
                decisionHandler(allowed ? .grant : .deny)
            }
        }
    }

    private func requestMicrophoneAccess(completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio, completionHandler: completion)
        case .denied, .restricted:
            completion(false)
        @unknown default:
            completion(false)
        }
    }

    private func ensureSpeechRecognitionAccess(then continueLoading: @escaping () -> Void) {
        let finish: (SFSpeechRecognizerAuthorizationStatus) -> Void = { [weak self] status in
            self?.log?.info("Spracheingabe-TCC", fields: ["status": self?.speechTccLabel(status) ?? "unknown"])
            continueLoading()
        }
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            finish(.authorized)
        case .denied:
            finish(.denied)
        case .restricted:
            finish(.restricted)
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async { finish(status) }
            }
        @unknown default:
            finish(SFSpeechRecognizer.authorizationStatus())
        }
    }

    private func microphoneTccLabel(_ status: AVAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorized: return "authorized"
        @unknown default: return "unknown"
        }
    }

    private func speechTccLabel(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .authorized: return "authorized"
        @unknown default: return "unknown"
        }
    }
}
