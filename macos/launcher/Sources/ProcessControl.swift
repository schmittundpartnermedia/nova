import Darwin
import Foundation

struct SpawnedProcess {
    let pid: pid_t
    let pgid: pid_t
    let argv: [String]
}

enum ProcessControl {
    static func isAlive(_ pid: pid_t) -> Bool {
        pid > 0 && kill(pid, 0) == 0
    }

    static func commandLine(pid: pid_t) -> String? {
        let output = runCapture("/bin/ps", ["-p", String(pid), "-o", "command="])
        let text = output?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }

    static func listeningPid(port: Int) -> pid_t? {
        let output = runCapture("/usr/sbin/lsof", ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-t"]) ?? ""
        let first = output.split(whereSeparator: \.isNewline).first.flatMap { Int32($0.trimmingCharacters(in: .whitespaces)) }
        return first.flatMap { $0 > 0 ? $0 : nil }
    }

    static func readPidFile(_ url: URL) -> pid_t? {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let pid = Int32(value), pid > 0 else { return nil }
        return pid
    }

    static func writePidFile(_ url: URL, pid: pid_t) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? String(pid).write(to: url, atomically: true, encoding: .utf8)
    }

    static func removeIfStale(pidFile: URL, expected: ((String) -> Bool)? = nil) {
        guard let pid = readPidFile(pidFile) else {
            try? FileManager.default.removeItem(at: pidFile)
            return
        }
        if !isAlive(pid) {
            try? FileManager.default.removeItem(at: pidFile)
            return
        }
        if let expected, let command = commandLine(pid: pid), !expected(command) {
            try? FileManager.default.removeItem(at: pidFile)
        }
    }

    static func looksLikeNovaWeb(_ command: String) -> Bool {
        let lower = command.lowercased()
        return lower.contains("next") && (lower.contains("dev") || lower.contains("start") || lower.contains("next-server") || lower.contains("/bin/next"))
    }

    static func looksLikeDesktop(_ command: String) -> Bool {
        let lower = command.lowercased()
        return lower.contains("desktop-service") || (lower.contains("tsx") && lower.contains("desktop"))
    }

    static func spawn(
        executable: URL,
        arguments: [String],
        cwd: URL,
        env: [String: String],
        logFile: URL
    ) throws -> SpawnedProcess {
        try FileManager.default.createDirectory(at: logFile.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: logFile.path) {
            FileManager.default.createFile(atPath: logFile.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }

        var attr: posix_spawnattr_t?
        posix_spawnattr_init(&attr)
        defer { posix_spawnattr_destroy(&attr) }
        posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETPGROUP))
        posix_spawnattr_setpgroup(&attr, 0)

        var fileActions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&fileActions)
        defer { posix_spawn_file_actions_destroy(&fileActions) }
        cwd.path.withCString { _ = posix_spawn_file_actions_addchdir_np(&fileActions, $0) }
        posix_spawn_file_actions_addopen(&fileActions, 0, "/dev/null", O_RDONLY, 0)
        logFile.path.withCString {
            _ = posix_spawn_file_actions_addopen(&fileActions, 1, $0, O_WRONLY | O_CREAT | O_APPEND, 0o600)
        }
        posix_spawn_file_actions_adddup2(&fileActions, 1, 2)

        let argv = [executable.path] + arguments
        let envList = env.map { "\($0.key)=\($0.value)" }.sorted()
        var pid: pid_t = 0
        let status = withCStringArray(argv) { argvPtr in
            withCStringArray(envList) { envPtr in
                posix_spawn(&pid, executable.path, &fileActions, &attr, argvPtr, envPtr)
            }
        }
        if status != 0 {
            throw LaunchError.start("Prozessstart fehlgeschlagen (\(executable.lastPathComponent), errno \(status)).")
        }
        return SpawnedProcess(pid: pid, pgid: pid, argv: argv)
    }

    static func stopOwned(_ process: SpawnedProcess, timeoutMs: Int = 2500) {
        let descendants = descendantPids(root: process.pid)
        if process.pgid > 0 {
            _ = kill(-process.pgid, SIGTERM)
        }
        _ = kill(process.pid, SIGTERM)
        for child in descendants {
            _ = kill(child, SIGTERM)
        }

        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000)
        while Date() < deadline {
            let alive = ([process.pid] + descendants).filter(isAlive)
            if alive.isEmpty { return }
            Thread.sleep(forTimeInterval: 0.1)
        }
        if process.pgid > 0 {
            _ = kill(-process.pgid, SIGKILL)
        }
        for pid in ([process.pid] + descendants) where isAlive(pid) {
            _ = kill(pid, SIGKILL)
        }
    }

    static func descendantPids(root: pid_t) -> [pid_t] {
        guard let output = runCapture("/bin/ps", ["-axo", "pid=,ppid="]) else { return [] }
        var children: [pid_t: [pid_t]] = [:]
        for line in output.split(whereSeparator: \.isNewline) {
            let parts = line.split(whereSeparator: \.isWhitespace).compactMap { Int32($0) }
            guard parts.count == 2 else { continue }
            children[parts[1], default: []].append(parts[0])
        }
        var seen: [pid_t] = []
        var queue: [pid_t] = [root]
        while let current = queue.first {
            queue.removeFirst()
            for child in children[current] ?? [] where !seen.contains(child) {
                seen.append(child)
                queue.append(child)
            }
        }
        return seen
    }

    private static func runCapture(_ launchPath: String, _ arguments: [String]) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: launchPath)
        process.arguments = arguments
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
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)
    }

    static func withCStringArray<T>(_ strings: [String], _ body: (UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> T) -> T {
        var pointers: [UnsafeMutablePointer<CChar>?] = strings.map { strdup($0) }
        pointers.append(nil)
        defer {
            for pointer in pointers {
                free(pointer)
            }
        }
        return pointers.withUnsafeMutableBufferPointer { buffer in
            body(buffer.baseAddress!)
        }
    }
}
