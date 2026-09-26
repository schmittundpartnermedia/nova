import AppKit
import ApplicationServices
import Darwin
import Foundation

/// Nimmt den einmaligen Mail-Automation-Consent im NOVA.app-GUI-Prozess entgegen.
/// Der Desktop-Helper wird dafür nicht gestartet und nicht per Disclaim zur eigenen TCC-Identität.
final class MailConsentBridge {
    private let socketPath: String
    private let log: LogWriter?
    private var listenFd: Int32 = -1
    private let queue = DispatchQueue(label: "io.elevum.nova.mail-consent")

    init(novaDir: URL, log: LogWriter?) {
        socketPath = novaDir.appendingPathComponent("mail-consent.sock").path
        self.log = log
    }

    func start() {
        queue.async { [weak self] in
            self?.serve()
        }
    }

    func stop() {
        if listenFd >= 0 {
            close(listenFd)
            listenFd = -1
        }
        unlink(socketPath)
    }

    private func serve() {
        unlink(socketPath)
        let sock = socket(AF_UNIX, SOCK_STREAM, 0)
        guard sock >= 0 else {
            log?.error("Mail-Consent-Socket fehlt")
            return
        }
        listenFd = sock
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        guard setSocketPath(socketPath, &addr) else {
            close(sock)
            listenFd = -1
            log?.error("Mail-Consent-Socket-Pfad ist zu lang")
            return
        }
        let bound = withUnsafePointer(to: &addr) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                bind(sock, sa, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0 else {
            close(sock)
            listenFd = -1
            log?.error("Mail-Consent-Socket bind fehlgeschlagen")
            return
        }
        chmod(socketPath, 0o600)
        guard listen(sock, 4) == 0 else {
            close(sock)
            listenFd = -1
            return
        }
        log?.info("Mail-Consent wartet im NOVA.app-Prozess", fields: ["socket": socketPath])
        while true {
            let client = accept(sock, nil, nil)
            if client < 0 { break }
            handle(client)
            close(client)
        }
    }

    private func handle(_ client: Int32) {
        var buffer = [UInt8](repeating: 0, count: 256)
        let count = read(client, &buffer, buffer.count)
        let text = count > 0 ? String(bytes: buffer.prefix(count), encoding: .utf8) ?? "" : ""
        guard text.contains("mail.consent") else {
            writeLine(client, #"{"ok":false,"error":"unknown"}"#)
            return
        }
        let outcome = DispatchQueue.main.sync { requestMailAutomationConsent() }
        log?.info("Mail-Consent beantwortet", fields: ["state": outcome.state, "code": String(outcome.code)])
        writeLine(client, #"{"ok":true,"state":"\#(outcome.state)","code":\#(outcome.code)}"#)
    }

    private func writeLine(_ fd: Int32, _ line: String) {
        var payload = line
        if !payload.hasSuffix("\n") { payload.append("\n") }
        _ = payload.withCString { ptr in
            Darwin.write(fd, ptr, strlen(ptr))
        }
    }
}

private func requestMailAutomationConsent() -> (state: String, code: OSStatus) {
    NSApp.activate(ignoringOtherApps: true)
    let target = NSAppleEventDescriptor(bundleIdentifier: "com.apple.mail")
    let code = AEDeterminePermissionToAutomateTarget(target.aeDesc, typeWildCard, typeWildCard, true)
    let state: String
    if code == noErr {
        state = "granted"
    } else if code == -1743 {
        state = "denied"
    } else if code == -1744 {
        state = "required"
    } else {
        state = "unavailable"
    }
    return (state, code)
}

private func setSocketPath(_ path: String, _ addr: inout sockaddr_un) -> Bool {
    let bytes = Array(path.utf8) + [0]
    guard bytes.count <= 104 else { return false }
    withUnsafeMutableBytes(of: &addr.sun_path) { raw in
        for (index, byte) in bytes.enumerated() {
            raw[index] = byte
        }
    }
    return true
}
