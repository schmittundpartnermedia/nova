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
    private var lockFd: Int32 = -1
    private let workQueue = DispatchQueue(label: "io.elevum.nova.supervisor", qos: .userInitiated)

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        if let existing = SingleInstance.existing(bundleIdentifier: LaunchConfig.defaultBundleIdentifier) {
            existing.activate(options: [.activateIgnoringOtherApps])
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
                NSApp.terminate(nil)
                return
            }
            supervisor = ProcessSupervisor(config: config, log: log)
            showStatus("STARTING", "Dependencies prüfen")
            log.info("NOVA.app gestartet", fields: [
                "microphoneTcc": microphoneTccLabel(AVCaptureDevice.authorizationStatus(for: .audio)),
            ])
            workQueue.async { [weak self] in
                self?.bootstrap()
            }
        } catch {
            presentError(error, logDirectory: nil)
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        workQueue.async { [weak self] in
            self?.handleReopen()
        }
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if shuttingDown { return .terminateNow }
        shuttingDown = true
        supervisor?.cancel()
        workQueue.async { [weak self] in
            self?.supervisor?.shutdownOwned()
            DispatchQueue.main.async {
                NSApp.reply(toApplicationShouldTerminate: true)
            }
        }
        return .terminateLater
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func bootstrap() {
        guard let supervisor else { return }
        do {
            try supervisor.start { [weak self] phase in
                DispatchQueue.main.sync {
                    self?.showStatus("STARTING", phase)
                }
            }
            DispatchQueue.main.async { [weak self] in
                self?.showStatus("READY", "NOVA UI öffnen")
                self?.openUI()
            }
        } catch {
            DispatchQueue.main.async { [weak self] in
                self?.presentError(error, logDirectory: self?.config?.logDir, fatal: true)
            }
        }
    }

    private func handleReopen() {
        guard let supervisor else { return }
        do {
            try supervisor.reopenOrRepair { [weak self] phase in
                DispatchQueue.main.sync {
                    self?.showStatus("STARTING", phase)
                }
            }
            DispatchQueue.main.async { [weak self] in
                self?.openUI()
            }
        } catch {
            DispatchQueue.main.async { [weak self] in
                self?.presentError(error, logDirectory: self?.config?.logDir, fatal: false)
            }
        }
    }

    private func openUI() {
        guard let config else { return }
        statusWindow?.close()
        statusWindow = nil
        switch config.uiMode {
        case .browser:
            NSWorkspace.shared.open(config.webURL)
        case .webview:
            if webWindow == nil {
                webWindow = NovaWebWindowController(startURL: config.webURL, log: log)
            }
            webWindow?.loadUI()
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func showStatus(_ phase: String, _ detail: String) {
        if statusWindow == nil {
            statusWindow = StatusWindowController()
        }
        statusWindow?.setPhase(phase, detail: detail)
        statusWindow?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func presentError(_ error: Error, logDirectory: URL?, fatal: Bool = true) {
        showStatus("ERROR", error.localizedDescription)
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
        let response = alert.runModal()
        if response == .alertSecondButtonReturn, let logDirectory {
            NSWorkspace.shared.open(logDirectory)
        }
        if fatal {
            NSApp.terminate(nil)
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

    private func buildMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Über NOVA", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "NOVA ausblenden", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Voice Session starten", action: #selector(startVoiceSession), keyEquivalent: "")
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

        NSApp.mainMenu = mainMenu
    }

    @objc private func startVoiceSession() {
        webWindow?.startVoiceFromPage()
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
