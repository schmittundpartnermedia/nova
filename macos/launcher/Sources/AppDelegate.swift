import AppKit
import AVFoundation
import Darwin

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusWindow: StatusWindowController?
    private var webWindow: NovaWebWindowController?
    private var supervisor: ProcessSupervisor?
    private var config: LaunchConfig?
    private var log: LogWriter?
    private var shuttingDown = false
    private var didShutdown = false
    private var uiReady = false
    private var showingError = false
    private var lockFd: Int32 = -1
    private var mailConsent: MailConsentBridge?
    private let workQueue = DispatchQueue(label: "io.elevum.nova.supervisor", qos: .userInitiated)
    private var pushToTalkMonitor: Any?
    private var pushToTalkLocalMonitor: Any?
    private var pushToTalkHeld = false
    private var einstellungen: EinstellungenWindowController?
    private var freigabeTimer: Timer?
    private var tastenfreigabe = Tastenfreigabe.erteilt

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        installPushToTalkMonitor()
        Tastenfreigabe.beimErstenStartAnfragen()
        beobachteTastenfreigabe()
        if let existing = SingleInstance.existing(bundleIdentifier: LaunchConfig.defaultBundleIdentifier) {
            existing.activate(options: [.activateIgnoringOtherApps])
            didShutdown = true
            NSApp.terminate(nil)
            return
        }

        do {
            let config = try LaunchConfig.load()
            self.config = config
            try FileManager.default.createDirectory(at: config.logDir, withIntermediateDirectories: true)
            let log = LogWriter(url: config.launcherLogFile)
            self.log = log
            if !acquireInstanceLock(at: config.novaDir.appendingPathComponent("launcher.lock")) {
                SingleInstance.existing(bundleIdentifier: config.bundleIdentifier)?.activate(options: [.activateIgnoringOtherApps])
                didShutdown = true
                NSApp.terminate(nil)
                return
            }
            supervisor = ProcessSupervisor(config: config, log: log)
            let consent = MailConsentBridge(novaDir: config.novaDir, log: log)
            mailConsent = consent
            consent.start()
            showStatus("CHECKING_ENVIRONMENT", "Dependencies prüfen")
            log.info("NOVA.app gestartet", fields: [
                "microphoneTcc": microphoneTccLabel(AVCaptureDevice.authorizationStatus(for: .audio)),
                "boot": LaunchConfig.systemBootDate().map { ISO8601DateFormatter().string(from: $0) } ?? "unknown",
            ])
            workQueue.async { [weak self] in
                self?.bootstrap()
            }
        } catch {
            presentError(error, logDirectory: nil)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if uiReady, webWindow?.window != nil {
            webWindow?.window?.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return true
        }
        if uiReady {
            openUI()
            return true
        }
        workQueue.async { [weak self] in
            self?.handleReopen()
        }
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if didShutdown { return .terminateNow }
        if shuttingDown { return .terminateLater }
        shuttingDown = true
        mailConsent?.stop()
        supervisor?.cancel()
        closeVisibleWindows(keepAlert: true)
        workQueue.async { [weak self] in
            self?.supervisor?.shutdownOwned()
            DispatchQueue.main.async {
                self?.didShutdown = true
                self?.releaseInstanceLock()
                self?.closeVisibleWindows(keepAlert: false)
                NSApp.reply(toApplicationShouldTerminate: true)
            }
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    private func bootstrap() {
        guard let supervisor else { return }
        do {
            try supervisor.start { [weak self] phase in
                DispatchQueue.main.sync {
                    self?.showStatus(supervisor.state.rawValue.uppercased(), phase)
                }
            }
            DispatchQueue.main.async { [weak self] in
                guard let self, !self.shuttingDown, !self.showingError else { return }
                self.config = supervisor.config
                self.showStatus("READY", "NOVA UI öffnen")
                self.openUI()
            }
        } catch {
            if supervisor.wasCancelled || shuttingDown {
                log?.info("Start nach Beenden still beendet")
                return
            }
            DispatchQueue.main.async { [weak self] in
                self?.presentError(error, logDirectory: self?.config?.logDir, fatal: true)
            }
        }
    }

    private func handleReopen() {
        guard let supervisor, !showingError, !shuttingDown else { return }
        do {
            try supervisor.reopenOrRepair { [weak self] phase in
                DispatchQueue.main.sync {
                    self?.showStatus(supervisor.state.rawValue.uppercased(), phase)
                }
            }
            DispatchQueue.main.async { [weak self] in
                self?.config = supervisor.config
                self?.openUI()
            }
        } catch {
            DispatchQueue.main.async { [weak self] in
                self?.presentError(error, logDirectory: self?.config?.logDir, fatal: false)
            }
        }
    }

    private func openUI() {
        guard let config = supervisor?.config ?? config else { return }
        self.config = config
        closeStatusWindow()
        switch config.uiMode {
        case .browser:
            uiReady = true
            NSWorkspace.shared.open(config.webURL)
        case .webview:
            if webWindow?.window == nil || webWindow?.pageURL != config.webURL {
                webWindow?.close()
                webWindow = nil
            }
            if webWindow == nil {
                let fenster = NovaWebWindowController(startURL: config.webURL, log: log)
                fenster.onEinstellungen = { [weak self] in self?.zeigeEinstellungen() }
                webWindow = fenster
            }
            uiReady = true
            webWindow?.loadUI()
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func showStatus(_ phase: String, _ detail: String) {
        if showingError { return }
        if statusWindow == nil {
            statusWindow = StatusWindowController()
        }
        statusWindow?.setPhase(phase, detail: detail)
        statusWindow?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func presentError(_ error: Error, logDirectory: URL?, fatal: Bool = true) {
        showingError = true
        uiReady = false
        closeStatusWindow()
        webWindow?.close()
        webWindow = nil
        log?.error(error.localizedDescription)
        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "NOVA konnte nicht starten"
        alert.informativeText = error.localizedDescription
            + (logDirectory != nil ? "\n\nLogs: \(logDirectory!.path)" : "")
        alert.addButton(withTitle: "OK")
        if logDirectory != nil {
            alert.addButton(withTitle: "Logs öffnen")
        }

        if ProcessInfo.processInfo.environment["NOVA_TEST_AUTOQUIT_ON_ERROR"] == "1" {
            log?.info("Testmodus: Fehlerdialog wird automatisch geschlossen")
            finishAfterError(openLogs: false, fatal: fatal)
            return
        }

        let response = alert.runModal()
        let openLogs = response == .alertSecondButtonReturn && logDirectory != nil
        if openLogs, let logDirectory {
            NSWorkspace.shared.open(logDirectory)
        }
        finishAfterError(openLogs: openLogs, fatal: fatal)
    }

    private func finishAfterError(openLogs: Bool, fatal: Bool) {
        closeVisibleWindows(keepAlert: false)
        showingError = false
        guard fatal else { return }
        shuttingDown = true
        mailConsent?.stop()
        workQueue.async { [weak self] in
            self?.supervisor?.shutdownOwned()
            DispatchQueue.main.async {
                self?.didShutdown = true
                self?.releaseInstanceLock()
                self?.closeVisibleWindows(keepAlert: false)
                NSApp.terminate(nil)
            }
        }
    }

    private func closeStatusWindow() {
        if let window = statusWindow?.window {
            window.orderOut(nil)
            window.close()
        }
        statusWindow?.close()
        statusWindow = nil
    }

    private func closeVisibleWindows(keepAlert: Bool) {
        closeStatusWindow()
        webWindow?.window?.orderOut(nil)
        webWindow?.close()
        webWindow = nil
        for window in NSApp.windows {
            if keepAlert, window.isSheet || window.className.contains("Alert") {
                continue
            }
            window.orderOut(nil)
            window.close()
        }
    }

    private func acquireInstanceLock(at url: URL) -> Bool {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        lockFd = open(url.path, O_CREAT | O_RDWR, 0o600)
        guard lockFd >= 0 else { return true }
        if flock(lockFd, LOCK_EX | LOCK_NB) != 0 {
            close(lockFd)
            lockFd = -1
            return false
        }
        return true
    }

    private func releaseInstanceLock() {
        if lockFd >= 0 {
            _ = flock(lockFd, LOCK_UN)
            close(lockFd)
            lockFd = -1
        }
    }

    private func buildMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Über NOVA", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Einstellungen …", action: #selector(zeigeEinstellungen), keyEquivalent: ",")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "NOVA ausblenden", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "NOVA beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Bearbeiten")
        editMenu.addItem(withTitle: "Ausschneiden", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Kopieren", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Einfügen", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Alles auswählen", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        let fensterItem = NSMenuItem()
        let fensterMenu = NSMenu(title: "Fenster")
        fensterMenu.addItem(withTitle: "Chat ein/aus", action: #selector(wechsleFenster), keyEquivalent: "k")
        fensterItem.submenu = fensterMenu
        mainMenu.addItem(fensterItem)

        NSApp.mainMenu = mainMenu
    }

    @objc private func wechsleFenster() {
        webWindow?.wechsleModus()
        webWindow?.window?.makeKeyAndOrderFront(nil)
    }

    @objc private func zeigeEinstellungen() {
        if einstellungen == nil {
            einstellungen = EinstellungenWindowController { [weak self] in
                self?.pushToTalkHeld = false
                self?.webWindow?.sendeAppZustand()
                self?.log?.info("Sprechtaste geändert", fields: ["taste": Sprechtaste.aktuell.rawValue])
            }
        }
        einstellungen?.zeigen()
    }

    /// Die Freigabe „Bedienungshilfen“ kann jederzeit in den Systemeinstellungen kommen oder gehen.
    /// Dann den globalen Beobachter neu anlegen und der Seite Bescheid geben.
    private func beobachteTastenfreigabe() {
        freigabeTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            guard let self else { return }
            let jetzt = Tastenfreigabe.erteilt
            guard jetzt != self.tastenfreigabe else { return }
            self.tastenfreigabe = jetzt
            self.log?.info("Tastenfreigabe geändert", fields: ["erteilt": jetzt ? "true" : "false"])
            if let monitor = self.pushToTalkMonitor { NSEvent.removeMonitor(monitor) }
            self.pushToTalkMonitor = nil
            self.installPushToTalkMonitor()
            self.webWindow?.sendeAppZustand()
        }
    }

    /// Systemweiter Push-to-Talk: Taste halten = Mikro an, loslassen = verarbeiten. Kein Dauerhören.
    /// Außerhalb von NOVA wirkt die Taste nur mit der Freigabe „Bedienungshilfen“.
    private func installPushToTalkMonitor() {
        if pushToTalkMonitor == nil {
            pushToTalkMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged, .keyDown, .keyUp]) { [weak self] event in
                self?.handlePushToTalk(event)
            }
        }
        if pushToTalkLocalMonitor == nil {
            pushToTalkLocalMonitor = NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged, .keyDown, .keyUp]) { [weak self] event in
                self?.handlePushToTalk(event)
                return event
            }
        }
    }

    private func handlePushToTalk(_ event: NSEvent) {
        let taste = Sprechtaste.aktuell
        guard event.keyCode == taste.keyCode else { return }
        let held: Bool
        if taste.istModifier {
            guard event.type == .flagsChanged else { return }
            held = taste.gehalten(event.modifierFlags)
        } else {
            guard event.type == .keyDown || event.type == .keyUp, !event.isARepeat else { return }
            held = event.type == .keyDown
        }
        if held && !pushToTalkHeld {
            pushToTalkHeld = true
            DispatchQueue.main.async { self.webWindow?.pushToTalkDown() }
        } else if !held && pushToTalkHeld {
            pushToTalkHeld = false
            DispatchQueue.main.async { self.webWindow?.pushToTalkUp() }
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
}
