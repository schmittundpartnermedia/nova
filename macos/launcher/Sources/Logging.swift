import Foundation

enum SecretRedactor {
    private static let patterns: [NSRegularExpression] = {
        let raw = [
            #"sk-[a-zA-Z0-9_-]{8,}"#,
            #"sk-ant-[a-zA-Z0-9_-]{8,}"#,
            #"ghp_[a-zA-Z0-9]{20,}"#,
            #"github_pat_[a-zA-Z0-9_]{20,}"#,
            #"xox[baprs]-[a-zA-Z0-9-]{10,}"#,
            #"AKIA[0-9A-Z]{16}"#,
            #"(?:OPENAI|ANTHROPIC|AWS_SECRET_ACCESS|STRIPE|DATABASE)_?(?:API_)?KEY\s*[:=]\s*\S+"#,
            #"(?:api[_-]?key|secret|password|token|passwd)\s*[:=]\s*["']?[^"'\s]{8,}"#,
            #"Bearer\s+[A-Za-z0-9._\-+=/]{12,}"#,
        ]
        return raw.compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
    }()

    static func redact(_ text: String) -> String {
        var next = text
        for pattern in patterns {
            let range = NSRange(next.startIndex..., in: next)
            next = pattern.stringByReplacingMatches(in: next, options: [], range: range, withTemplate: "[redacted]")
        }
        return next
    }

    static func shouldKeepEnvKey(_ key: String) -> Bool {
        let upper = key.uppercased()
        return !(upper.contains("KEY")
            || upper.contains("SECRET")
            || upper.contains("TOKEN")
            || upper.contains("PASSWORD")
            || upper.contains("PASSWD")
            || upper.contains("CREDENTIAL")
            || upper.contains("PRIVATE"))
    }
}

final class LogWriter {
    private let url: URL
    private let queue = DispatchQueue(label: "io.elevum.nova.logger")
    private let fm = FileManager.default

    init(url: URL) {
        self.url = url
        if !fm.fileExists(atPath: url.path) {
            fm.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
    }

    func info(_ message: String, fields: [String: String] = [:]) {
        write(level: "info", message: message, fields: fields)
    }

    func warn(_ message: String, fields: [String: String] = [:]) {
        write(level: "warn", message: message, fields: fields)
    }

    func error(_ message: String, fields: [String: String] = [:]) {
        write(level: "error", message: message, fields: fields)
    }

    private func write(level: String, message: String, fields: [String: String]) {
        queue.sync {
            rotateIfNeeded()
            var payload: [String: String] = [
                "ts": ISO8601DateFormatter().string(from: Date()),
                "service": "nova-launcher",
                "level": level,
                "message": SecretRedactor.redact(message),
            ]
            for (key, value) in fields {
                payload[key] = SecretRedactor.shouldKeepEnvKey(key) ? SecretRedactor.redact(value) : "[redacted]"
            }
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let line = String(data: data, encoding: .utf8)
            else { return }
            if let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                _ = try? handle.seekToEnd()
                if let bytes = (line + "\n").data(using: .utf8) {
                    try? handle.write(contentsOf: bytes)
                }
            }
        }
    }

    private func rotateIfNeeded() {
        guard let attrs = try? fm.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? NSNumber,
              size.intValue > 8_000_000
        else { return }
        let old = url.appendingPathExtension("old")
        try? fm.removeItem(at: old)
        try? fm.moveItem(at: url, to: old)
        fm.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
    }
}

enum EnvFile {
    static func parse(url: URL) -> [String: String] {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return [:] }
        var values: [String: String] = [:]
        for line in raw.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            let usable = trimmed.hasPrefix("export ") ? String(trimmed.dropFirst(7)) : trimmed
            guard let eq = usable.firstIndex(of: "=") else { continue }
            let key = String(usable[..<eq]).trimmingCharacters(in: .whitespaces)
            var value = String(usable[usable.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            if (value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'")) {
                value = String(value.dropFirst().dropLast())
            }
            if !key.isEmpty { values[key] = value }
        }
        return values
    }
}
