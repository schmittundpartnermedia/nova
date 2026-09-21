import AppKit
import Darwin
import Foundation

final class ProcessSupervisor {
    private(set) var config: LaunchConfig
    private let log: LogWriter
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

    func assertDependencies(progress: (String) -> Void) throws {
        progress("Dependencies prüfen")
        let fm = FileManager.default
        guard fm.fileExists(atPath: config.projectRoot.appendingPathComponent("package.json").path) else {
            throw LaunchError.dependency("package.json im NOVA-Projekt fehlt.")
        }
        guard fm.isExecutableFile(atPath: config.nodeBin.path) else {
            throw LaunchError.dependency("Node.js ist nicht ausführbar: \(config.nodeBin.path)")
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
        log.info("Abhängigkeiten geprüft", fields: [
            "mode": config.mode.rawValue,
            "projectRoot": config.projectRoot.path,
            "node": config.nodeBin.path,
        ])
    }

    func cancel() {
        cancelled = true
    }

    func start(progress: (String) -> Void) throws {
        try prepareDirectories()
        try assertDependencies(progress: progress)
        cleanStalePidFiles()

        progress("NOVA starten")
        try ensureWeb()
        progress("Desktop Service starten")
        try ensureDesktop()
        progress("Health Checks")
        try waitUntilReady()
        persistSession()
        log.info("NOVA bereit")
    }

    func reopenOrRepair(progress: (String) -> Void) throws {
        if HealthMonitor.isWebReachable(config: config),
           case .success = HealthMonitor.isDesktopHealthy(config: config, token: HealthMonitor.readDesktopToken(config: config))
        {
            log.info("Bestehende gesunde Dienste wiederverwendet")
            return
        }
        progress("Abgestürzte Dienste neu starten")
        try restartMissingOwnedOrStart()
        try waitUntilReady()
        persistSession()
    }

    func shutdownOwned() {
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
    }

    var helperAvailable: Bool {
        FileManager.default.isExecutableFile(atPath: config.helperBin.path)
    }

    private func cleanStalePidFiles() {
        ProcessControl.removeIfStale(pidFile: config.webPidFile, expected: ProcessControl.looksLikeNovaWeb)
        ProcessControl.removeIfStale(pidFile: config.desktopPidFile, expected: ProcessControl.looksLikeDesktop)
        ProcessControl.removeIfStale(pidFile: config.launcherPidFile)
        ProcessControl.writePidFile(config.launcherPidFile, pid: getpid())
    }

    private func ensureWeb() throws {
        if HealthMonitor.isWebReachable(config: config) {
            reusedWeb = true
            log.info("NOVA Web-Dienst läuft bereits und bleibt unangetastet")
            return
        }
        if let pid = ProcessControl.listeningPid(port: config.webPort) {
            throw LaunchError.start("Port \(config.webPort) ist belegt (PID \(pid)), antwortet aber nicht als NOVA. Der Prozess wird nicht beendet.")
        }
        let argv = webArguments()
        let spawned = try ProcessControl.spawn(
            executable: config.nodeBin,
            arguments: argv,
            cwd: config.projectRoot,
            env: childEnvironment(),
            logFile: config.webLogFile
        )
        lock.lock()
        ownedWeb = spawned
        reusedWeb = false
        lock.unlock()
        ProcessControl.writePidFile(config.webPidFile, pid: spawned.pid)
        log.info("NOVA Web-Dienst gestartet", fields: ["pid": String(spawned.pid), "mode": config.mode.rawValue])
    }

    private func ensureDesktop() throws {
        if case .success = HealthMonitor.isDesktopHealthy(config: config, token: HealthMonitor.readDesktopToken(config: config)) {
            reusedDesktop = true
            log.info("Desktop Service läuft bereits und bleibt unangetastet")
            return
        }
        if let pid = ProcessControl.listeningPid(port: config.desktopPort) {
            throw LaunchError.start("Port \(config.desktopPort) ist belegt (PID \(pid)), der Desktop Service ist aber nicht gesund. Der Prozess wird nicht beendet.")
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
        log.info("Desktop Service gestartet", fields: ["pid": String(spawned.pid)])
    }

    private func restartMissingOwnedOrStart() throws {
        if !HealthMonitor.isWebReachable(config: config) {
            if let web = ownedWeb, !ProcessControl.isAlive(web.pid) {
                ownedWeb = nil
            }
            if ProcessControl.listeningPid(port: config.webPort) != nil {
                throw LaunchError.start("NOVA auf Port \(config.webPort) ist ungesund. Der fremde Prozess wird nicht beendet.")
            }
            try ensureWeb()
        }
        if case .failure = HealthMonitor.isDesktopHealthy(config: config, token: HealthMonitor.readDesktopToken(config: config)) {
            if let desktop = ownedDesktop, !ProcessControl.isAlive(desktop.pid) {
                ownedDesktop = nil
            }
            if ProcessControl.listeningPid(port: config.desktopPort) != nil {
                throw LaunchError.start("Desktop Service auf Port \(config.desktopPort) ist ungesund. Der fremde Prozess wird nicht beendet.")
            }
            try ensureDesktop()
        }
    }

    private func waitUntilReady() throws {
        let webDeadline = Date().addingTimeInterval(90)
        while Date() < webDeadline {
            try throwIfCancelled()
            if HealthMonitor.isWebReachable(config: config) { break }
            if let web = ownedWeb, !ProcessControl.isAlive(web.pid) {
                throw LaunchError.start("NOVA Web-Dienst wurde beendet, bevor Port \(config.webPort) erreichbar war. Details in nova-web.log.")
            }
            Thread.sleep(forTimeInterval: 0.4)
        }
        guard HealthMonitor.isWebReachable(config: config) else {
            throw LaunchError.health("NOVA wurde nicht unter http://\(config.webHost):\(config.webPort) erreichbar.")
        }

        let desktopDeadline = Date().addingTimeInterval(45)
        var lastError: LaunchError = .health("Desktop Service nicht bereit.")
        while Date() < desktopDeadline {
            try throwIfCancelled()
            let token = HealthMonitor.readDesktopToken(config: config)
            switch HealthMonitor.isDesktopHealthy(config: config, token: token) {
            case .success:
                if !HealthMonitor.helperResponds(config: config) {
                    throw LaunchError.health("Desktop Service läuft, aber der Native Helper antwortet nicht.")
                }
                return
            case .failure(let error):
                lastError = error
            }
            if let desktop = ownedDesktop, !ProcessControl.isAlive(desktop.pid) {
                throw LaunchError.start("Desktop Service wurde beendet, bevor er bereit war. Details in desktop-service.log.")
            }
            Thread.sleep(forTimeInterval: 0.4)
        }
        throw lastError
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

    private func childEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + (env["PATH"] ?? "")
        env["HOME"] = env["HOME"] ?? NSHomeDirectory()
        env["LANG"] = env["LANG"] ?? "de_DE.UTF-8"
        env["NODE_ENV"] = config.mode == .production ? "production" : "development"
        env["PORT"] = String(config.webPort)
        env["HOSTNAME"] = config.webHost
        env["NOVA_DESKTOP_HOST"] = config.desktopHost
        env["NOVA_DESKTOP_PORT"] = String(config.desktopPort)
        env.removeValue(forKey: "NOVA_DESKTOP_TOKEN")
        for (key, value) in EnvFile.parse(url: config.envFile) {
            env[key] = value
        }
        return env
    }

    private func throwIfCancelled() throws {
        if cancelled { throw LaunchError.start("NOVA.app-Start wurde abgebrochen.") }
    }

    private func persistSession() {
        let payload: [String: Any] = [
            "launcherPid": Int(getpid()),
            "startedAt": ISO8601DateFormatter().string(from: Date()),
            "mode": config.mode.rawValue,
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

    private func jsonPid(_ process: SpawnedProcess?) -> Any {
        guard let process else { return NSNull() }
        return ["pid": Int(process.pid), "pgid": Int(process.pgid)]
    }
}

enum SingleInstance {
    static func existing(bundleIdentifier: String) -> NSRunningApplication? {
        NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
            .first { $0.processIdentifier != getpid() && !$0.isTerminated }
    }
}
