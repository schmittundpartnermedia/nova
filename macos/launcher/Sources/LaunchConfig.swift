import Foundation

enum LaunchMode: String {
    case development
    case production
}

enum UIMode: String {
    case webview
    case browser
}

struct LaunchConfig {
    let bundleIdentifier: String
    let appName: String
    let projectRoot: URL
    let mode: LaunchMode
    let uiMode: UIMode
    let webHost: String
    let webPort: Int
    let desktopHost: String
    let desktopPort: Int
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

    var desktopHealthURL: URL {
        URL(string: "http://\(desktopHost):\(desktopPort)/health")!
    }

    var desktopTokenFile: URL {
        novaDir.appendingPathComponent("desktop-token")
    }

    var webPidFile: URL {
        novaDir.appendingPathComponent("nova-web.pid")
    }

    var desktopPidFile: URL {
        novaDir.appendingPathComponent("desktop-service.pid")
    }

    var launcherPidFile: URL {
        novaDir.appendingPathComponent("launcher.pid")
    }

    var sessionFile: URL {
        novaDir.appendingPathComponent("launcher-session.json")
    }

    var launcherLogFile: URL {
        logDir.appendingPathComponent("launcher.log")
    }

    var webLogFile: URL {
        logDir.appendingPathComponent("nova-web.log")
    }

    var desktopLogFile: URL {
        logDir.appendingPathComponent("desktop-service.log")
    }

    static let defaultBundleIdentifier = "io.elevum.nova"

    static func load() throws -> LaunchConfig {
        let bundled = Bundle.main.url(forResource: "LaunchConfig", withExtension: "plist")
        let plist = bundled.flatMap { NSDictionary(contentsOf: $0) as? [String: Any] } ?? [:]

        let mode = LaunchMode(rawValue: string(plist["NOVALaunchMode"], fallback: "development")) ?? .development
        let uiMode = UIMode(rawValue: string(plist["NOVAUIMode"], fallback: "webview")) ?? .webview
        let webHost = string(plist["NOVAWebHost"], fallback: "127.0.0.1")
        let desktopHost = string(plist["NOVADesktopHost"], fallback: "127.0.0.1")
        let webPort = int(plist["NOVAWebPort"], fallback: 3000)
        let desktopPort = int(plist["NOVADesktopPort"], fallback: 47821)
        let startAtLogin = bool(plist["NOVAStartAtLogin"], fallback: false)

        let projectRoot = try resolveProjectRoot(plist: plist)
        let nodeBin = try resolveNode(plist: plist)
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
            webPort: webPort,
            desktopHost: desktopHost,
            desktopPort: desktopPort,
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

    private static func resolveProjectRoot(plist: [String: Any]) throws -> URL {
        let fm = FileManager.default
        let candidates: [URL] = [
            envURL("NOVA_PROJECT_ROOT"),
            string(plist["NOVAProjectRoot"], fallback: "").isEmpty
                ? nil
                : URL(fileURLWithPath: string(plist["NOVAProjectRoot"], fallback: ""), isDirectory: true),
            Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent(),
            URL(fileURLWithPath: "/Volumes/My Book 24/NOVA", isDirectory: true),
        ].compactMap { $0 }

        for candidate in candidates {
            let packageJSON = candidate.appendingPathComponent("package.json")
            if fm.fileExists(atPath: packageJSON.path),
               let data = try? Data(contentsOf: packageJSON),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               (json["name"] as? String) == "nova"
            {
                return candidate.standardizedFileURL
            }
        }
        throw LaunchError.dependency("NOVA-Projektordner wurde nicht gefunden.")
    }

    private static func resolveNode(plist: [String: Any]) throws -> URL {
        let fm = FileManager.default
        var paths = [
            envURL("NOVA_NODE_BIN")?.path,
            string(plist["NOVANodeBin"], fallback: "").isEmpty ? nil : string(plist["NOVANodeBin"], fallback: ""),
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
        ].compactMap { $0 }

        if let login = whichFromLoginShell("node") {
            paths.append(login)
        }

        for path in paths where fm.isExecutableFile(atPath: path) {
            return URL(fileURLWithPath: path)
        }
        throw LaunchError.dependency("Node.js wurde nicht gefunden. Erwartet z. B. /usr/local/bin/node.")
    }

    private static func whichFromLoginShell(_ command: String) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "command -v \(command)"]
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
        return value.isEmpty ? nil : value
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
