import Foundation
import AppKit
import ApplicationServices

// NOVA-Helfer für Apple Mail.
// Aufruf: nova-desktop-helper '<JSON>' – das Kommando kommt als argv-JSON,
// die Antwort geht als eine JSON-Zeile auf stdout.
// Unterstützte Kommandos:
//   {"cmd":"app.launch","app":"<Bundle-ID>"}   – App starten (z. B. com.apple.mail)
//   {"cmd":"automation.mail"}                  – Automation-Freigabe für Mail abfragen
//   {"cmd":"applescript.run","script":"..."}   – AppleScript ausführen
// Keine Bildschirmaufnahme, keine Bedienungshilfen, keine Maus-/Tastatur-Eingabe.

struct Command: Decodable {
    let cmd: String
    let app: String?
    let script: String?
}

func writeJSON(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else {
        fputs("{\"ok\":false,\"error\":\"json_encode_failed\"}\n", stdout)
        return
    }
    FileHandle.standardOutput.write(data)
    fputs("\n", stdout)
}

// Fragt den Automation-Status für Apple Mail ab, ohne einen Dialog auszulösen.
func mailAutomationState() -> [String: Any] {
    let target = NSAppleEventDescriptor(bundleIdentifier: "com.apple.mail")
    let status = AEDeterminePermissionToAutomateTarget(
        target.aeDesc,
        typeWildCard,
        typeWildCard,
        false
    )
    let state: String
    if status == noErr {
        state = "granted"
    } else if status == -1743 {
        state = "denied"
    } else if status == -1744 {
        state = "required"
    } else {
        state = "unavailable"
    }
    return ["ok": true, "data": ["state": state, "code": Int(status)]]
}

// Sperrt AppleScript-Konstrukte, die aus dem Mail-Kontext ausbrechen könnten.
func appleScriptBlocked(_ source: String) -> String? {
    let lower = source.lowercased()
    if lower.contains("do shell script") { return "do_shell_script_blocked" }
    if lower.contains("do javascript") { return "do_javascript_blocked" }
    if lower.contains("run script") { return "run_script_blocked" }
    if !lower.contains("tell application") { return "missing_tell_application" }
    return nil
}

func runAppleScript(_ source: String) -> [String: Any] {
    let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
        return ["ok": false, "error": "missing_script"]
    }
    if let blocked = appleScriptBlocked(trimmed) {
        return ["ok": false, "error": blocked]
    }
    var error: NSDictionary?
    guard let script = NSAppleScript(source: trimmed) else {
        return ["ok": false, "error": "applescript_compile_failed"]
    }
    let result = script.executeAndReturnError(&error)
    if let error {
        let code = error[NSAppleScript.errorNumber] as? Int ?? 1
        if code == -1743 || code == -1744 {
            return ["ok": false, "permission": "automation", "error": "PERMISSION_REQUIRED"]
        }
        return [
            "ok": false,
            "error": (error[NSAppleScript.errorMessage] as? String) ?? "applescript_failed",
            "code": code,
        ]
    }
    return ["ok": true, "data": ["output": result.stringValue ?? ""]]
}

// Startet eine App über ihre Bundle-ID (LaunchServices).
func launchApp(_ bundleIdentifier: String) -> [String: Any] {
    let trimmed = bundleIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
        return ["ok": false, "error": "missing_app"]
    }
    guard let target = NSWorkspace.shared.urlForApplication(withBundleIdentifier: trimmed) else {
        return ["ok": false, "error": "app_not_found", "name": trimmed]
    }
    let configuration = NSWorkspace.OpenConfiguration()
    var launchError: String?
    let sem = DispatchSemaphore(value: 0)
    NSWorkspace.shared.openApplication(at: target, configuration: configuration) { _, error in
        launchError = error?.localizedDescription
        sem.signal()
    }
    // Der TS-Aufrufer wartet 12 s; hier höchstens 10 s, damit die Antwort noch ankommt.
    if sem.wait(timeout: .now() + 10) == .timedOut {
        return ["ok": false, "name": trimmed, "path": target.path, "error": "launch_timeout"]
    }
    return ["ok": launchError == nil, "name": trimmed, "path": target.path, "error": launchError ?? ""]
}

let raw = CommandLine.arguments.dropFirst().joined(separator: " ")
guard let data = raw.data(using: .utf8), let command = try? JSONDecoder().decode(Command.self, from: data) else {
    writeJSON(["ok": false, "error": "invalid_command"])
    exit(1)
}

switch command.cmd {
case "app.launch":
    writeJSON(launchApp(command.app ?? ""))
case "automation.mail":
    writeJSON(mailAutomationState())
case "applescript.run":
    writeJSON(runAppleScript(command.script ?? ""))
default:
    writeJSON(["ok": false, "error": "unknown_cmd", "cmd": command.cmd])
    exit(1)
}
