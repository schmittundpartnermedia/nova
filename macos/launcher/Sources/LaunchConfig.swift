import Darwin
import Foundation

enum LaunchMode: String {
    case development
    case production
}

enum UIMode: String {
    case webview
    case browser
}

enum SupervisorState: String {
    case idle
    case checkingEnvironment
    case checkingVolume
    case checkingRuntime
    case startingApplicationService
    case waitingApplicationHealth
    case startingWorker
    case waitingWorkerHealth
    case checkingNativeHelper
    case ready
    case startFailed
    case shuttingDown
}

struct LaunchConfig {
    let bundleIdentifier: String
    let appName: String
    let projectRoot: URL
    let mode: LaunchMode
    let uiMode: UIMode
    let webHost: String
    let preferredWebPort: Int
    var webPort: Int
    let nodeBin: URL
    let nextBin: URL
    let tsxBin: URL
    let helperApp: URL
    let helperBin: URL
    let envFile: URL
    let novaDir: URL
    let logDir: URL
    let startAtLogin: Bool

    var webURL: URL {
        URL(string: "http://\(webHost):\(webPort)/")!
    }

    var webHealthURL: URL {
        URL(string: "http://\(webHost):\(webPort)/api/nova/ready")!
    }

    var webPidFile: URL {
        novaDir.appendingPathComponent("nova-web.pid")
    }

    var workerPidFile: URL {
        novaDir.appendingPathComponent("worker.pid")
    }

    var workerHeartbeatFile: URL {
        novaDir.appendingPathComponent("worker.heartbeat")
    }

    var launcherPidFile: URL {
        novaDir.appendingPathComponent("launcher.pid")
    }

    var sessionFile: URL {
        novaDir.appendingPathComponent("launcher-session.json")
    }

    var runtimePinFile: URL {
        novaDir.appendingPathComponent("runtime.json")
    }

    var webPortFile: URL {
        novaDir.appendingPathComponent("web-port")
    }

    var webPortRange: ClosedRange<Int> {
        Self.portRange(preferred: preferredWebPort, span: 100)
    }

    var launcherLogFile: URL {
        logDir.appendingPathComponent("launcher.log")
    }

    var webLogFile: URL {
        logDir.appendingPathComponent("nova-web.log")
    }

    var workerLogFile: URL {
        logDir.appendingPathComponent("worker.log")
    }

    var volumeRoot: URL? {
        let parts = projectRoot.pathComponents
        guard parts.count >= 3, parts[1] == "Volumes" else { return nil }
        return URL(fileURLWithPath: "/" + parts[1] + "/" + parts[2], isDirectory: true)
    }

    static let defaultBundleIdentifier = "io.elevum.nova"

    static func load() throws -> LaunchConfig {
        let bundled = Bundle.main.url(forResource: "LaunchConfig", withExtension: "plist")
        let plist = bundled.flatMap { NSDictionary(contentsOf: $0) as? [String: Any] } ?? [:]

        let mode = LaunchMode(rawValue: string(plist["NOVALaunchMode"], fallback: "development")) ?? .development
        let uiMode = UIMode(rawValue: string(plist["NOVAUIMode"], fallback: "webview")) ?? .webview
        let webHost = string(plist["NOVAWebHost"], fallback: "127.0.0.1")
        let preferredWebPort = int(plist["NOVAWebPort"], fallback: 3100)
        let startAtLogin = bool(plist["NOVAStartAtLogin"], fallback: false)

        let projectRoot = try resolveProjectRoot(plist: plist)
        let nodeBin = try resolveNode(plist: plist, projectRoot: projectRoot)
        let nextBin = projectRoot.appendingPathComponent("node_modules/next/dist/bin/next")
        let tsxBin = projectRoot.appendingPathComponent("node_modules/tsx/dist/cli.mjs")
        let helperApp = projectRoot.appendingPathComponent("services/desktop-service/native/bin/NOVA Desktop Helper.app")
        let helperBin = helperApp.appendingPathComponent("Contents/MacOS/nova-desktop-helper")
        let envFile = projectRoot.appendingPathComponent(".env")
        let novaDir = projectRoot.appendingPathComponent(".nova")
        let logDir = novaDir.appendingPathComponent("logs")

        return LaunchConfig(
            bundleIdentifier: Bundle.main.bundleIdentifier ?? defaultBundleIdentifier,
            appName: "NOVA",
            projectRoot: projectRoot,
            mode: mode,
            uiMode: uiMode,
            webHost: webHost,
            preferredWebPort: preferredWebPort,
            webPort: preferredWebPort,
            nodeBin: nodeBin,
            nextBin: nextBin,
            tsxBin: tsxBin,
            helperApp: helperApp,
            helperBin: helperBin,
            envFile: envFile,
            novaDir: novaDir,
            logDir: logDir,
            startAtLogin: startAtLogin
        )
    }

    static func systemBootDate() -> Date? {
        var tv = timeval()
        var size = MemoryLayout<timeval>.stride
        guard sysctlbyname("kern.boottime", &tv, &size, nil, 0) == 0 else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(tv.tv_sec))
    }

    private static func resolveProjectRoot(plist: [String: Any]) throws -> URL {
        let candidates: [URL] = [
            envURL("NOVA_PROJECT_ROOT"),
            string(plist["NOVAProjectRoot"], fallback: "").isEmpty
                ? nil
                : URL(fileURLWithPath: string(plist["NOVAProjectRoot"], fallback: ""), isDirectory: true),
            Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent(),
            URL(fileURLWithPath: "/Volumes/ELEVUM/Projekte/joachim/NOVA", isDirectory: true),
        ].compactMap { $0 }

        for candidate in candidates {
            if isNovaProject(candidate) {
                return candidate.standardizedFileURL
            }
        }
        throw LaunchError.dependency("NOVA-Projektordner wurde nicht gefunden.")
    }

    static func isNovaProject(_ url: URL) -> Bool {
        let packageJSON = url.appendingPathComponent("package.json")
        guard FileManager.default.fileExists(atPath: packageJSON.path),
              let data = try? Data(contentsOf: packageJSON),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              (json["name"] as? String) == "nova"
        else { return false }
        return true
    }

    static func projectAvailability(projectRoot: URL) -> (ready: Bool, message: String) {
        let fm = FileManager.default
        let parts = projectRoot.pathComponents
        if parts.count >= 3, parts[1] == "Volumes" {
            let volume = URL(fileURLWithPath: "/" + parts[1] + "/" + parts[2], isDirectory: true)
            var isDir: ObjCBool = false
            if !fm.fileExists(atPath: volume.path, isDirectory: &isDir) || !isDir.boolValue {
                return (false, "Das Volume „\(parts[2])“ ist nicht gemountet. Bitte das Laufwerk anschließen und NOVA erneut starten.")
            }
            if !isVolumeReadable(volume) {
                return (false, "Das Volume „\(parts[2])“ ist gemountet, aber noch nicht lesbar.")
            }
        }
        if !fm.fileExists(atPath: projectRoot.path) {
            return (false, "NOVA-Projektordner fehlt: \(projectRoot.path)")
        }
        if !isNovaProject(projectRoot) {
            return (false, "Unter \(projectRoot.path) liegt kein gültiges NOVA-Projekt.")
        }
        return (true, "Projekt verfügbar")
    }

    private static func isVolumeReadable(_ volume: URL) -> Bool {
        FileManager.default.isReadableFile(atPath: volume.path)
    }

    private static func resolveNode(plist: [String: Any], projectRoot: URL) throws -> URL {
        let fm = FileManager.default
        var paths: [String] = []

        if let env = envURL("NOVA_NODE_BIN")?.path {
            paths.append(env)
        }
        let pinned = string(plist["NOVANodeBin"], fallback: "")
        if !pinned.isEmpty {
            paths.append(pinned)
        }
        if let saved = readPinnedNode(projectRoot: projectRoot) {
            paths.append(saved)
        }
        paths.append(contentsOf: [
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
        ])
        paths.append(contentsOf: wellKnownVersionManagerNodes())

        var seen = Set<String>()
        for path in paths {
            let standardized = URL(fileURLWithPath: path).standardizedFileURL.path
            if seen.contains(standardized) { continue }
            seen.insert(standardized)
            if fm.isExecutableFile(atPath: standardized), nodeVersion(at: standardized) != nil {
                return URL(fileURLWithPath: standardized)
            }
        }
        throw LaunchError.dependency("Node.js wurde nicht gefunden. NOVA erwartet eine feste Runtime unter /usr/local/bin/node oder dem in LaunchConfig.plist gesetzten NOVANodeBin.")
    }

    private static func readPinnedNode(projectRoot: URL) -> String? {
        let url = projectRoot.appendingPathComponent(".nova/runtime.json")
        guard let data = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let path = json["nodeBin"] as? String,
              !path.isEmpty
        else { return nil }
        return path
    }

    private static func wellKnownVersionManagerNodes() -> [String] {
        let home = NSHomeDirectory()
        let fm = FileManager.default
        var found: [String] = []
        let aliases = [
            "\(home)/.local/share/fnm/aliases/default/bin/node",
            "\(home)/Library/Application Support/fnm/aliases/default/bin/node",
        ]
        found.append(contentsOf: aliases.filter { fm.isExecutableFile(atPath: $0) })

        let nvmRoot = URL(fileURLWithPath: "\(home)/.nvm/versions/node")
        if let versions = try? fm.contentsOfDirectory(at: nvmRoot, includingPropertiesForKeys: nil) {
            let nodes = versions
                .map { $0.appendingPathComponent("bin/node").path }
                .filter { fm.isExecutableFile(atPath: $0) }
                .sorted()
            found.append(contentsOf: nodes.reversed())
        }
        return found
    }

    static func nodeVersion(at path: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = ["-v"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return nil
        }
        guard process.terminationStatus == 0 else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let value = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.hasPrefix("v") ? value : nil
    }

    private static func portRange(preferred: Int, span: Int) -> ClosedRange<Int> {
        let start = min(max(preferred, 1), 65535)
        let end = min(start + max(span - 1, 0), 65535)
        return start...end
    }

    private static func envURL(_ key: String) -> URL? {
        guard let raw = ProcessInfo.processInfo.environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty
        else { return nil }
        return URL(fileURLWithPath: raw)
    }

    private static func string(_ value: Any?, fallback: String) -> String {
        if let text = value as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return fallback
    }

    private static func int(_ value: Any?, fallback: Int) -> Int {
        if let number = value as? Int { return number }
        if let text = value as? String, let number = Int(text) { return number }
        return fallback
    }

    private static func bool(_ value: Any?, fallback: Bool) -> Bool {
        if let flag = value as? Bool { return flag }
        if let text = value as? String { return ["1", "true", "yes"].contains(text.lowercased()) }
        return fallback
    }
}

enum LaunchError: LocalizedError {
    case dependency(String)
    case start(String)
    case health(String)
    case alreadyRunning

    var errorDescription: String? {
        switch self {
        case .dependency(let message), .start(let message), .health(let message):
            return message
        case .alreadyRunning:
            return "NOVA läuft bereits."
        }
    }
}
