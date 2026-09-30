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

/// Größe des NOVA-Fensters: klein in der Bildschirmecke (Orb + Statuszeile, immer im Vordergrund) oder mit Chat.
enum FensterModus: String {
    case ecke
    case chat
}

/// WKUserContentController hält seinen Handler fest; der Umweg vermeidet einen Kreis mit dem Fenster.
private final class NachrichtenWeiche: NSObject, WKScriptMessageHandler {
    weak var ziel: WKScriptMessageHandler?
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        ziel?.userContentController(controller, didReceive: message)
    }
}

final class NovaWebWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, NSWindowDelegate {
    private var webView: WKWebView!
    private let startURL: URL
    private let log: LogWriter?
    private var loadAttempts = 0
    private let maxLoadAttempts = 8
    private let weiche = NachrichtenWeiche()
    private(set) var modus: FensterModus
    /// Die Seite bittet um die Einstellungen (Zahnrad in der Ecke).
    var onEinstellungen: (() -> Void)?
    var pageURL: URL { startURL }

    private static let modusSchluessel = "novaFensterModus"
    private static let eckeGroesse = NSSize(width: 280, height: 340)
    private static let chatGroesse = NSSize(width: 1120, height: 760)

    init(startURL: URL, log: LogWriter? = nil) {
        self.startURL = startURL
        self.log = log
        self.modus = FensterModus(rawValue: UserDefaults.standard.string(forKey: Self.modusSchluessel) ?? "") ?? .ecke
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.eckeGroesse),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "NOVA"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .black
        window.isReleasedWhenClosed = false
        window.setAccessibilityElement(true)
        window.setAccessibilityRole(.window)
        window.setAccessibilityTitle("NOVA")
        super.init(window: window)
        window.delegate = self
        let config = WKWebViewConfiguration()
        weiche.ziel = self
        config.userContentController.add(weiche, name: "nova")
        webView = WKWebView(frame: window.contentView?.bounds ?? .zero, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.setAccessibilityElement(true)
        webView.setAccessibilityRole(.group)
        webView.setAccessibilityLabel("NOVA")
        window.contentView = webView
        window.makeFirstResponder(webView)
        wendeModusAn(modus, animiert: false)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    // MARK: Ecke / Chat

    func setzeModus(_ neu: FensterModus) {
        guard neu != modus else { return }
        merkeRahmen()
        modus = neu
        UserDefaults.standard.set(neu.rawValue, forKey: Self.modusSchluessel)
        wendeModusAn(neu, animiert: true)
        sendeAppZustand()
        log?.info("Fenstermodus", fields: ["modus": neu.rawValue])
    }

    func wechsleModus() {
        setzeModus(modus == .ecke ? .chat : .ecke)
    }

    private func wendeModusAn(_ modus: FensterModus, animiert: Bool) {
        guard let window else { return }
        let ecke = modus == .ecke
        window.level = ecke ? .floating : .normal
        window.collectionBehavior = ecke ? [.canJoinAllSpaces, .fullScreenAuxiliary] : [.managed]
        for knopf in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            window.standardWindowButton(knopf)?.isHidden = ecke
        }
        window.contentMinSize = ecke ? NSSize(width: 220, height: 280) : NSSize(width: 720, height: 520)
        window.setFrame(gemerkterRahmen(fuer: modus) ?? standardRahmen(fuer: modus), display: true, animate: animiert)
    }

    private func standardRahmen(fuer modus: FensterModus) -> NSRect {
        let flaeche = (window?.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        switch modus {
        case .ecke:
            let g = Self.eckeGroesse
            return NSRect(x: flaeche.maxX - g.width - 20, y: flaeche.minY + 20, width: g.width, height: g.height)
        case .chat:
            let g = NSSize(width: min(Self.chatGroesse.width, flaeche.width - 40), height: min(Self.chatGroesse.height, flaeche.height - 40))
            return NSRect(x: flaeche.midX - g.width / 2, y: flaeche.midY - g.height / 2, width: g.width, height: g.height)
        }
    }

    /// Ein gemerkter Rahmen gilt nur, wenn er noch auf einem angeschlossenen Bildschirm liegt.
    private func gemerkterRahmen(fuer modus: FensterModus) -> NSRect? {
        guard let text = UserDefaults.standard.string(forKey: "novaRahmen.\(modus.rawValue)") else { return nil }
        let rahmen = NSRectFromString(text)
        guard rahmen.width > 100, NSScreen.screens.contains(where: { $0.visibleFrame.intersects(rahmen) }) else { return nil }
        return rahmen
    }

    private func merkeRahmen() {
        guard let window, window.isVisible else { return }
        UserDefaults.standard.set(NSStringFromRect(window.frame), forKey: "novaRahmen.\(modus.rawValue)")
    }

    func windowDidMove(_ notification: Notification) { merkeRahmen() }
    func windowDidEndLiveResize(_ notification: Notification) { merkeRahmen() }

    // MARK: Brücke zur Seite

    /// Die Seite erfährt Modus, Sprechtaste und ob die Taste überall wirkt (window.__novaApp + Ereignis „nova-app“).
    func sendeAppZustand() {
        let skript = Self.appZustandSkript(modus: modus)
        webView.configuration.userContentController.removeAllUserScripts()
        webView.configuration.userContentController.addUserScript(
            WKUserScript(source: skript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        webView.evaluateJavaScript(skript, completionHandler: nil)
    }

    private static func appZustandSkript(modus: FensterModus) -> String {
        let taste = Sprechtaste.aktuell.name.replacingOccurrences(of: "\"", with: "")
        return """
        window.__novaApp = { modus: "\(modus.rawValue)", taste: "\(taste)", tasteUeberall: \(Tastenfreigabe.erteilt ? "true" : "false") };
        window.dispatchEvent(new CustomEvent('nova-app'));
        """
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let art = body["art"] as? String else { return }
        switch art {
        case "modus":
            if let wert = body["modus"] as? String, let neu = FensterModus(rawValue: wert) { setzeModus(neu) }
        case "einstellungen":
            onEinstellungen?()
        default:
            log?.warn("Unbekannte Nachricht der Seite", fields: ["art": art])
        }
    }

    // MARK: Laden

    func loadUI() {
        loadAttempts = 0
        sendeAppZustand()
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

    /// Globaler Hotkey: halten = aufnehmen, loslassen = verarbeiten (kein Dauerhören).
    func pushToTalkDown() {
        webView.evaluateJavaScript(
            """
            (function() {
              window.dispatchEvent(new CustomEvent('nova-ptt', { detail: { phase: 'down' } }));
              return 'down';
            })()
            """
        ) { [weak self] result, error in
            self?.log?.info("PTT-Down", fields: [
                "result": (result as? String) ?? error?.localizedDescription ?? "nil",
            ])
        }
    }

    func pushToTalkUp() {
        webView.evaluateJavaScript(
            """
            (function() {
              window.dispatchEvent(new CustomEvent('nova-ptt', { detail: { phase: 'up' } }));
              return 'up';
            })()
            """
        ) { [weak self] result, error in
            self?.log?.info("PTT-Up", fields: [
                "result": (result as? String) ?? error?.localizedDescription ?? "nil",
            ])
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
