import AppKit
import Darwin
import Foundation

final class ProcessSupervisor {
    private(set) var config: LaunchConfig
    private let log: LogWriter
    private(set) var state: SupervisorState = .idle
    private var ownedWeb: SpawnedProcess?
    private var ownedDesktop: SpawnedProcess?
    private var reusedWeb = false
    private var reusedDesktop = false
    private var cancelled = false
    private let lock = NSLock()

    init(config: LaunchConfig, log: LogWriter) {
        self.config = config
        self.log = log
    }

    func prepareDirectories() throws {
        let fm = FileManager.default
        try fm.createDirectory(at: config.novaDir, withIntermediateDirectories: true)
        try fm.createDirectory(at: config.logDir, withIntermediateDirectories: true)
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: config.novaDir.path)
    }

    func cancel() {
        cancelled = true
    }

    var wasCancelled: Bool { cancelled }

    func start(progress: (String) -> Void) throws {
        do {
            try transition(.checkingEnvironment, progress, "Umgebung prüfen")
            try prepareDirectories()
            try assertEnvironment()

            try transition(.checkingVolume, progress, "Volume prüfen")
            try waitForVolume(progress: progress)

            try transition(.checkingRuntime, progress, "Runtime prüfen")
            try assertRuntime()
            cleanStalePidFiles()

            try transition(.startingApplicationService, progress, "Application Service starten")
            try ensureWeb()

            try transition(.waitingApplicationHealth, progress, "Application Service Health")
            try waitForApplicationHealth()

            try transition(.startingDesktopService, progress, "Desktop Service starten")
            try ensureDesktop()

            try transition(.waitingDesktopHealth, progress, "Desktop Service Health")
            try waitForDesktopHealth()

            try transition(.checkingNativeHelper, progress, "Native Helper prüfen")
            try waitForHelper()

            try transition(.ready, progress, "NOVA UI öffnen")
            persistSession()
            persistRuntimePin()
            log.info("NOVA bereit", fields: diagnosticFields())
        } catch {
            if cancelled {
                setState(.shuttingDown)
                log.info("Start abgebrochen")
                throw error
            }
            setState(.startFailed)
            log.error(error.localizedDescription, fields: diagnosticFields(extra: [
                "sanitizedError": SecretRedactor.redact(error.localizedDescription),
            ]))
            throw annotated(error)
        }
    }

    func reopenOrRepair(progress: (String) -> Void) throws {
        if case .success = HealthMonitor.isApplicationHealthy(config: config),
           case .success = HealthMonitor.isDesktopHealthy(config: config, token: HealthMonitor.readDesktopToken(config: config))
        {
            log.info("Bestehende gesunde Dienste wiederverwendet")
            return
        }
        progress("Abgestürzte Dienste neu starten")
        try restartMissingOwnedOrStart()
        try waitForApplicationHealth()
        try waitForDesktopHealth()
        try waitForHelper()
        persistSession()
    }

    func shutdownOwned() {
        setState(.shuttingDown)
        lock.lock()
        let web = ownedWeb
        let desktop = ownedDesktop
        ownedWeb = nil
        ownedDesktop = nil
        lock.unlock()

        if let web {
            log.info("Beende von NOVA.app gestarteten Web-Dienst", fields: ["pid": String(web.pid)])
            ProcessControl.stopOwned(web)
        } else {
            log.info("Web-Dienst wird nicht beendet, weil er nicht von dieser Session stammt")
        }
        if let desktop {
            log.info("Beende von NOVA.app gestarteten Desktop Service", fields: ["pid": String(desktop.pid)])
            ProcessControl.stopOwned(desktop)
        } else {
            log.info("Desktop Service wird nicht beendet, weil er nicht von dieser Session stammt")
        }
        try? FileManager.default.removeItem(at: config.launcherPidFile)
        try? FileManager.default.removeItem(at: config.sessionFile)
        if web != nil { try? FileManager.default.removeItem(at: config.webPidFile) }
        if desktop != nil { try? FileManager.default.removeItem(at: config.desktopPidFile) }
        log.info("Shutdown abgeschlossen")
    }

    var helperAvailable: Bool {
        FileManager.default.isExecutableFile(atPath: config.helperBin.path)
    }

    private func transition(_ next: SupervisorState, _ progress: (String) -> Void, _ detail: String) throws {
        try throwIfCancelled()
        setState(next)
        progress(detail)
        log.info("Zustand", fields: diagnosticFields(extra: ["detail": detail]))
    }

    private func setState(_ next: SupervisorState) {
        state = next
    }

    private func assertEnvironment() throws {
        let home = ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory()
        log.info("Launcher-Umgebung", fields: [
            "home": home,
            "cwd": FileManager.default.currentDirectoryPath,
            "projectRoot": config.projectRoot.path,
            "bundle": Bundle.main.bundlePath,
            "path": childPath(),
        ])
        if home.isEmpty {
            throw LaunchError.dependency("HOME ist nicht gesetzt. NOVA.app darf nicht von einer unvollständigen GUI-Umgebung abhängen.")
        }
    }

    private func waitForVolume(progress: (String) -> Void) throws {
        let deadline = Date().addingTimeInterval(30)
        var last = "Volume wird geprüft"
        while Date() < deadline {
            try throwIfCancelled()
            let status = LaunchConfig.projectAvailability(projectRoot: config.projectRoot)
            if status.ready {
                log.info("Volume verfügbar", fields: [
                    "projectRoot": config.projectRoot.path,
                    "volume": config.volumeRoot?.path ?? "internal",
                ])
                return
            }
            last = status.message
            progress(status.message)
            log.warn(status.message)
            Thread.sleep(forTimeInterval: 0.4)
        }
        throw LaunchError.dependency(last)
    }

    private func assertRuntime() throws {
        let fm = FileManager.default
        guard fm.isExecutableFile(atPath: config.nodeBin.path) else {
            throw LaunchError.dependency("Node.js ist nicht ausführbar: \(config.nodeBin.path)")
        }
        guard let version = LaunchConfig.nodeVersion(at: config.nodeBin.path) else {
            throw LaunchError.dependency("Node.js unter \(config.nodeBin.path) antwortet nicht auf -v.")
        }
        guard fm.fileExists(atPath: config.nextBin.path) else {
            throw LaunchError.dependency("Next.js fehlt. Bitte im Projekt `npm install` ausführen.")
        }
        guard fm.fileExists(atPath: config.tsxBin.path) else {
            throw LaunchError.dependency("tsx fehlt. Bitte im Projekt `npm install` ausführen.")
        }
        guard fm.fileExists(atPath: config.envFile.path) else {
            throw LaunchError.dependency("Die Datei .env fehlt im NOVA-Projekt.")
        }
        if config.mode == .production {
            let buildMarker = config.projectRoot.appendingPathComponent(".next/BUILD_ID")
            let standalone = config.projectRoot.appendingPathComponent(".next/standalone/server.js")
            if !fm.fileExists(atPath: buildMarker.path) && !fm.fileExists(atPath: standalone.path) {
                throw LaunchError.dependency("Kein Production-Build gefunden. Bitte `npm run build` ausführen oder LaunchMode development verwenden.")
            }
        }
        log.info("Runtime geprüft", fields: [
            "mode": config.mode.rawValue,
            "node": config.nodeBin.path,
            "nodeVersion": version,
            "executable": config.nodeBin.path,
            "cwd": config.projectRoot.path,
        ])
    }

    private func cleanStalePidFiles() {
        ProcessControl.removeIfStale(pidFile: config.webPidFile, expected: ProcessControl.looksLikeNovaWeb)
        ProcessControl.removeIfStale(pidFile: config.desktopPidFile, expected: ProcessControl.looksLikeDesktop)
        ProcessControl.removeIfStale(pidFile: config.launcherPidFile)
        ProcessControl.writePidFile(config.launcherPidFile, pid: getpid())
    }

    private func ensureWeb() throws {
        try claimWebPort()
        persistBoundPorts()
        if case .success = HealthMonitor.isApplicationHealthy(config: config, timeout: 2, requireNovaWeb: true) {
            reusedWeb = true
            log.info("NOVA Application Service läuft bereits und bleibt unangetastet", fields: [
                "port": String(config.webPort),
            ])
            return
        }
        let spawned = try ProcessControl.spawn(
            executable: config.nodeBin,
            arguments: webArguments(),
            cwd: config.projectRoot,
            env: childEnvironment(),
            logFile: config.webLogFile
        )
        lock.lock()
        ownedWeb = spawned
        reusedWeb = false
        lock.unlock()
        ProcessControl.writePidFile(config.webPidFile, pid: spawned.pid)
        log.info("Application Service gestartet", fields: [
            "pid": String(spawned.pid),
            "port": String(config.webPort),
            "mode": config.mode.rawValue,
            "executable": config.nodeBin.path,
            "cwd": config.projectRoot.path,
        ])
    }

    private func ensureDesktop() throws {
        try claimDesktopPort()
        persistBoundPorts()
        if case .success = HealthMonitor.isDesktopHealthy(config: config, token: HealthMonitor.readDesktopToken(config: config)) {
            reusedDesktop = true
            log.info("Desktop Service läuft bereits und bleibt unangetastet", fields: [
                "port": String(config.desktopPort),
            ])
            return
        }
        let spawned = try ProcessControl.spawn(
            executable: config.nodeBin,
            arguments: [config.tsxBin.path, "services/desktop-service/index.ts"],
            cwd: config.projectRoot,
            env: childEnvironment(),
            logFile: config.desktopLogFile
        )
        lock.lock()
        ownedDesktop = spawned
        reusedDesktop = false
        lock.unlock()
        ProcessControl.writePidFile(config.desktopPidFile, pid: spawned.pid)
        log.info("Desktop Service gestartet", fields: [
            "pid": String(spawned.pid),
            "port": String(config.desktopPort),
            "executable": config.nodeBin.path,
            "cwd": config.projectRoot.path,
        ])
    }

    private func claimWebPort() throws {
        if let existing = findHealthyNovaWebPort() {
            if existing != config.preferredWebPort {
                log.info("Bestehenden NOVA-Web-Port wiederverwendet", fields: [
                    "preferred": String(config.preferredWebPort),
                    "port": String(existing),
                ])
            }
            config.webPort = existing
            return
        }
        let chosen = try firstFreePort(in: config.webPortRange, preferred: config.preferredWebPort, label: "NOVA-Web")
        if chosen != config.preferredWebPort {
            log.warn("Port \(config.preferredWebPort) ist belegt. NOVA weicht auf \(chosen) aus, ohne den anderen Prozess zu beenden.")
        }
        config.webPort = chosen
    }

    private func claimDesktopPort() throws {
        if case .success = HealthMonitor.isDesktopHealthy(config: config, token: HealthMonitor.readDesktopToken(config: config)) {
            return
        }
        if let last = readBoundPort(config.desktopPortFile), last != config.desktopPort {
            var probe = config
            probe.desktopPort = last
            if case .success = HealthMonitor.isDesktopHealthy(config: probe, token: HealthMonitor.readDesktopToken(config: probe)) {
                config.desktopPort = last
                return
            }
        }
        let listening = ProcessControl.listeningTcpPorts()
        if listening[config.desktopPort] == nil {
            return
        }
        let chosen = try firstFreePort(in: config.desktopPortRange, preferred: config.preferredDesktopPort, label: "Desktop-Service")
        if chosen != config.preferredDesktopPort {
            log.warn("Port \(config.preferredDesktopPort) ist belegt. Desktop Service weicht auf \(chosen) aus, ohne den anderen Prozess zu beenden.")
        }
        config.desktopPort = chosen
    }

    private func findHealthyNovaWebPort() -> Int? {
        var ordered: [Int] = []
        if let last = readBoundPort(config.webPortFile) {
            ordered.append(last)
        }
        ordered.append(config.preferredWebPort)
        let listening = ProcessControl.listeningTcpPorts()
        for port in config.webPortRange where listening[port] != nil {
            ordered.append(port)
        }
        for (port, pid) in listening {
            guard let command = ProcessControl.commandLine(pid: pid),
                  command.contains(config.projectRoot.path),
                  ProcessControl.looksLikeNovaWeb(command)
            else { continue }
            ordered.append(port)
        }
        var seen = Set<Int>()
        for port in ordered {
            if seen.contains(port) { continue }
            seen.insert(port)
            var probe = config
            probe.webPort = port
            if case .success = HealthMonitor.isApplicationHealthy(config: probe, timeout: 1.5, requireNovaWeb: true) {
                return port
            }
        }
        return nil
    }

    private func firstFreePort(in range: ClosedRange<Int>, preferred: Int, label: String) throws -> Int {
        let listening = ProcessControl.listeningTcpPorts()
        let ordered = [preferred] + range.filter { $0 != preferred }
        for port in ordered where listening[port] == nil {
            return port
        }
        throw LaunchError.start("Kein freier \(label)-Port im Bereich \(range.lowerBound)–\(range.upperBound). Fremde Prozesse werden nicht beendet.")
    }

    private func readBoundPort(_ url: URL) -> Int? {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let port = Int(value), (1...65535).contains(port) else { return nil }
        return port
    }

    private func persistBoundPorts() {
        try? String(config.webPort).write(to: config.webPortFile, atomically: true, encoding: .utf8)
        try? String(config.desktopPort).write(to: config.desktopPortFile, atomically: true, encoding: .utf8)
    }

    private func restartMissingOwnedOrStart() throws {
        if case .failure = HealthMonitor.isApplicationHealthy(config: config, requireNovaWeb: true) {
            if let web = ownedWeb, !ProcessControl.isAlive(web.pid) {
                ownedWeb = nil
            }
            try ensureWeb()
        }
        if case .failure = HealthMonitor.isDesktopHealthy(config: config, token: HealthMonitor.readDesktopToken(config: config)) {
            if let desktop = ownedDesktop, !ProcessControl.isAlive(desktop.pid) {
                ownedDesktop = nil
            }
            try ensureDesktop()
        }
    }

    private func waitForApplicationHealth() throws {
        let deadline = Date().addingTimeInterval(90)
        var last: LaunchError = .health("Application Service nicht bereit.")
        while Date() < deadline {
            try throwIfCancelled()
            if let crash = crashedOwned(ownedWeb, name: "Application Service", logFile: config.webLogFile) {
                throw crash
            }
            switch HealthMonitor.isApplicationHealthy(config: config, requireNovaWeb: true) {
            case .success:
                if let web = ownedWeb, !ProcessControl.isOwnedListener(port: config.webPort, root: web.pid) {
                    log.warn("Port \(config.webPort) antwortet, Listener ist aber nicht der gestartete NOVA-Prozess")
                }
                log.info("Application Service bereit", fields: diagnosticFields())
                return
            case .failure(let error):
                last = error
            }
            Thread.sleep(forTimeInterval: 0.35)
        }
        throw last
    }

    private func waitForDesktopHealth() throws {
        let deadline = Date().addingTimeInterval(60)
        var last: LaunchError = .health("Desktop Service nicht bereit.")
        while Date() < deadline {
            try throwIfCancelled()
            if let crash = crashedOwned(ownedDesktop, name: "Desktop Service", logFile: config.desktopLogFile) {
                throw crash
            }
            switch HealthMonitor.isDesktopHealthy(config: config, token: HealthMonitor.readDesktopToken(config: config)) {
            case .success:
                log.info("Desktop Service bereit", fields: diagnosticFields())
                return
            case .failure(let error):
                last = error
            }
            Thread.sleep(forTimeInterval: 0.35)
        }
        throw last
    }

    private func waitForHelper() throws {
        let deadline = Date().addingTimeInterval(20)
        var last: LaunchError = .health("Native Helper nicht bereit.")
        while Date() < deadline {
            try throwIfCancelled()
            switch HealthMonitor.helperResponds(config: config) {
            case .success:
                log.info("Native Helper bereit", fields: ["executable": config.helperBin.path])
                return
            case .failure(let error):
                last = error
            }
            Thread.sleep(forTimeInterval: 0.4)
        }
        throw last
    }

    private func crashedOwned(_ process: SpawnedProcess?, name: String, logFile: URL) -> LaunchError? {
        guard let process else { return nil }
        if ProcessControl.isAlive(process.pid) { return nil }
        let exitText = ProcessControl.childExitDescription(process.pid) ?? "Prozess ist weg"
        let tail = SecretRedactor.redact(ProcessControl.tailFile(logFile))
        let snippet = tail.isEmpty ? "Keine Ausgabe in \(logFile.lastPathComponent)." : tail
        return .start("\(name) wurde beendet (\(exitText)), bevor der Health-Check erfolgreich war.\n\nLetzte Ausgabe:\n\(snippet)")
    }

    private func annotated(_ error: Error) -> Error {
        if let existing = error as? LaunchError {
            switch existing {
            case .dependency, .alreadyRunning:
                return existing
            case .start, .health:
                return LaunchError.start(existing.localizedDescription + "\n\n" + failureContext())
            }
        }
        return LaunchError.start(error.localizedDescription + "\n\n" + failureContext())
    }

    private func failureContext() -> String {
        let webAlive = ownedWeb.map { ProcessControl.isAlive($0.pid) } ?? false
        let desktopAlive = ownedDesktop.map { ProcessControl.isAlive($0.pid) } ?? false
        let webListen = HealthMonitor.tcpIsOpen(host: config.webHost, port: config.webPort)
        let desktopListen = HealthMonitor.tcpIsOpen(host: config.desktopHost, port: config.desktopPort)
        let webTail = SecretRedactor.redact(ProcessControl.tailFile(config.webLogFile, maxBytes: 1200))
        var lines = [
            "Zustand: \(state.rawValue)",
            "cwd: \(config.projectRoot.path)",
            "Node: \(config.nodeBin.path)",
            "Application PID: \(ownedWeb.map { String($0.pid) } ?? "—") \(webAlive ? "läuft" : "nicht aktiv")",
            "Port \(config.webPort): \(webListen ? "offen" : "geschlossen")",
            "Desktop PID: \(ownedDesktop.map { String($0.pid) } ?? "—") \(desktopAlive ? "läuft" : "nicht aktiv")",
            "Port \(config.desktopPort): \(desktopListen ? "offen" : "geschlossen")",
        ]
        if !webTail.isEmpty {
            lines.append("nova-web.log:\n\(webTail)")
        }
        return lines.joined(separator: "\n")
    }

    private func webArguments() -> [String] {
        let host = config.webHost
        let port = String(config.webPort)
        switch config.mode {
        case .development:
            return [config.nextBin.path, "dev", "--hostname", host, "--port", port]
        case .production:
            let standalone = config.projectRoot.appendingPathComponent(".next/standalone/server.js")
            if FileManager.default.fileExists(atPath: standalone.path) {
                return [standalone.path]
            }
            return [config.nextBin.path, "start", "--hostname", host, "--port", port]
        }
    }

    private func childPath() -> String {
        let nodeDir = config.nodeBin.deletingLastPathComponent().path
        return [nodeDir, "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
            .filter { !$0.isEmpty }
            .joined(separator: ":")
    }

    private func childEnvironment() -> [String: String] {
        let inherited = ProcessInfo.processInfo.environment
        var env: [String: String] = [:]
        for key in ["HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP", "SHELL", "LANG", "LC_ALL"] {
            if let value = inherited[key], !value.isEmpty {
                env[key] = value
            }
        }
        env["HOME"] = env["HOME"] ?? NSHomeDirectory()
        env["LANG"] = env["LANG"] ?? "de_DE.UTF-8"
        env["PATH"] = childPath()
        env["PWD"] = config.projectRoot.path
        env["NOVA_PROJECT_ROOT"] = config.projectRoot.path
        env["NODE_ENV"] = config.mode == .production ? "production" : "development"
        env["PORT"] = String(config.webPort)
        env["HOSTNAME"] = config.webHost
        env["NOVA_WEB_HOST"] = config.webHost
        env["NOVA_WEB_PORT"] = String(config.webPort)
        env["NOVA_DESKTOP_HOST"] = config.desktopHost
        env["NOVA_DESKTOP_PORT"] = String(config.desktopPort)
        env["NEXT_TELEMETRY_DISABLED"] = "1"
        env.removeValue(forKey: "NOVA_DESKTOP_TOKEN")
        for (key, value) in EnvFile.parse(url: config.envFile) {
            env[key] = value
        }
        return env
    }

    private func throwIfCancelled() throws {
        if cancelled { throw LaunchError.start("NOVA.app-Start wurde abgebrochen.") }
    }

    private func persistRuntimePin() {
        let payload: [String: Any] = [
            "nodeBin": config.nodeBin.path,
            "projectRoot": config.projectRoot.path,
            "webHost": config.webHost,
            "webPort": config.webPort,
            "desktopHost": config.desktopHost,
            "desktopPort": config.desktopPort,
            "resolvedAt": ISO8601DateFormatter().string(from: Date()),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) {
            try? data.write(to: config.runtimePinFile, options: [.atomic])
        }
    }

    private func persistSession() {
        let payload: [String: Any] = [
            "launcherPid": Int(getpid()),
            "startedAt": ISO8601DateFormatter().string(from: Date()),
            "mode": config.mode.rawValue,
            "state": state.rawValue,
            "node": config.nodeBin.path,
            "cwd": config.projectRoot.path,
            "webPort": config.webPort,
            "desktopPort": config.desktopPort,
            "owned": [
                "web": jsonPid(ownedWeb),
                "desktop": jsonPid(ownedDesktop),
            ],
            "reused": [
                "web": reusedWeb,
                "desktop": reusedDesktop,
            ],
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) {
            try? data.write(to: config.sessionFile, options: [.atomic])
        }
    }

    private func diagnosticFields(extra: [String: String] = [:]) -> [String: String] {
        var fields: [String: String] = [
            "state": state.rawValue,
            "pid": String(getpid()),
            "executable": Bundle.main.executablePath ?? "NOVA",
            "cwd": config.projectRoot.path,
            "node": config.nodeBin.path,
            "webPort": String(config.webPort),
            "desktopPort": String(config.desktopPort),
        ]
        if let web = ownedWeb {
            fields["webPid"] = String(web.pid)
            fields["webAlive"] = ProcessControl.isAlive(web.pid) ? "true" : "false"
        }
        if let desktop = ownedDesktop {
            fields["desktopPid"] = String(desktop.pid)
            fields["desktopAlive"] = ProcessControl.isAlive(desktop.pid) ? "true" : "false"
        }
        for (key, value) in extra {
            fields[key] = value
        }
        return fields
    }

    private func jsonPid(_ process: SpawnedProcess?) -> Any {
        guard let process else { return NSNull() }
        return [
            "pid": Int(process.pid),
            "pgid": Int(process.pgid),
            "startedAt": ISO8601DateFormatter().string(from: process.startedAt),
        ]
    }
}

enum SingleInstance {
    static func existing(bundleIdentifier: String) -> NSRunningApplication? {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
            .first { $0.processIdentifier != getpid() && !$0.isTerminated }
    }
}
