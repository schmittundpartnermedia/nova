import ImageIO
import UniformTypeIdentifiers
import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import ScreenCaptureKit
import Darwin

private let tccDisclaimEnv = "NOVA_HELPER_TCC_DISCLAIMED"
private let tccAxResultEnv = "NOVA_HELPER_AX_RESULT"

@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(
    _ attrs: UnsafeMutablePointer<posix_spawnattr_t?>,
    _ disclaim: Int32
) -> Int32

@_silgen_name("responsibility_get_pid_responsible_for_pid")
func responsibility_get_pid_responsible_for_pid(_ pid: pid_t) -> pid_t

struct Command: Decodable {
    let cmd: String
    let app: String?
    let identifier: String?
    let value: String?
    let script: String?
    let maxDepth: Int?
    let persist: Bool?
}

func writeJSON(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else {
        fputs("{\"ok\":false,\"error\":\"json_encode_failed\"}\n", stdout)
        return
    }
    FileHandle.standardOutput.write(data)
    fputs("\n", stdout)
}

func axTrusted() -> Bool {
    return AXIsProcessTrusted()
}

func screenTrusted() -> Bool {
    if #available(macOS 11.0, *) {
        return CGPreflightScreenCaptureAccess()
    }
    return false
}

func helperExecutablePath() -> String {
    var size = UInt32(PATH_MAX)
    var buffer = [CChar](repeating: 0, count: Int(size))
    let status = buffer.withUnsafeMutableBufferPointer { ptr in
        _NSGetExecutablePath(ptr.baseAddress, &size)
    }
    if status == 0 {
        return String(cString: buffer)
    }
    return CommandLine.arguments.first ?? "nova-desktop-helper"
}

func withCStringArray(_ strings: [String], _ body: (UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) -> Int32) -> Int32 {
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

func reexecDisclaimedIfNeeded(extraEnv: [String: String] = [:]) {
    guard getenv(tccDisclaimEnv) == nil else { return }
    let me = getpid()
    let responsible = responsibility_get_pid_responsible_for_pid(me)
    guard responsible > 0, responsible != me else { return }

    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    defer { posix_spawnattr_destroy(&attr) }
    guard responsibility_spawnattrs_setdisclaim(&attr, 1) == 0 else { return }

    let exe = helperExecutablePath()
    let argv = [exe] + Array(CommandLine.arguments.dropFirst())
    var env = ProcessInfo.processInfo.environment
    env[tccDisclaimEnv] = "1"
    for (key, value) in extraEnv {
        env[key] = value
    }
    let envList = env.map { "\($0.key)=\($0.value)" }

    var child: pid_t = 0
    let spawned = withCStringArray(argv) { argvPtr in
        withCStringArray(envList) { envPtr in
            posix_spawn(&child, exe, nil, &attr, argvPtr, envPtr)
        }
    }
    guard spawned == 0 else { return }

    var status: Int32 = 0
    _ = waitpid(child, &status, 0)
    if (status & 0x7f) == 0 {
        exit((status >> 8) & 0xff)
    }
    exit(1)
}

func requestScreenRecordingAccess() -> Bool {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.accessory)
    if #available(macOS 10.15, *) {
        return CGRequestScreenCaptureAccess()
    }
    return false
}

func listApps() -> [[String: Any]] {
    NSWorkspace.shared.runningApplications.compactMap { app in
        guard let name = app.localizedName else { return nil }
        return [
            "name": name,
            "bundleId": app.bundleIdentifier ?? "",
            "pid": app.processIdentifier,
            "active": app.isActive,
            "hidden": app.isHidden,
        ]
    }
}

func listInstalled() -> [String] {
    let fm = FileManager.default
    let dir = "/Applications"
    let items = (try? fm.contentsOfDirectory(atPath: dir)) ?? []
    return items.filter { $0.hasSuffix(".app") }.map { String($0.dropLast(4)) }.sorted()
}

func attribute(_ element: AXUIElement, _ name: CFString) -> Any? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, name, &value)
    guard result == .success else { return nil }
    return value
}

func inspectElement(_ element: AXUIElement, depth: Int, maxDepth: Int) -> [String: Any] {
    let role = attribute(element, kAXRoleAttribute as CFString) as? String ?? ""
    let title = attribute(element, kAXTitleAttribute as CFString) as? String ?? ""
    let identifier = attribute(element, kAXIdentifierAttribute as CFString) as? String ?? ""
    let description = attribute(element, kAXDescriptionAttribute as CFString) as? String ?? ""
    var node: [String: Any] = [
        "role": role,
        "title": title,
        "identifier": identifier,
        "description": description,
    ]
    if depth >= maxDepth { return node }
    guard let children = attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] else {
        return node
    }
    node["children"] = children.prefix(40).map { inspectElement($0, depth: depth + 1, maxDepth: maxDepth) }
    return node
}

func stringAttr(_ element: AXUIElement, _ name: CFString) -> String {
    attribute(element, name) as? String ?? ""
}

func elementMatches(_ element: AXUIElement, needle: String) -> Bool {
    let n = needle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !n.isEmpty else { return false }
    let fields = [
        stringAttr(element, kAXIdentifierAttribute as CFString),
        stringAttr(element, kAXTitleAttribute as CFString),
        stringAttr(element, kAXDescriptionAttribute as CFString),
        stringAttr(element, kAXHelpAttribute as CFString),
        stringAttr(element, kAXRoleDescriptionAttribute as CFString),
        stringAttr(element, kAXValueAttribute as CFString),
    ].map { $0.lowercased() }.filter { !$0.isEmpty }
    if fields.contains(where: { $0 == n || $0.contains(n) }) { return true }
    let role = stringAttr(element, kAXRoleAttribute as CFString).lowercased()
    if n.contains(":") {
        let parts = n.split(separator: ":", maxSplits: 1)
        if parts.count == 2 {
            let roleNeedle = String(parts[0])
            let titleNeedle = String(parts[1])
            if role.contains(roleNeedle) && fields.contains(where: { $0.contains(titleNeedle) }) {
                return true
            }
        }
    }
    return false
}

func describeElement(_ element: AXUIElement) -> [String: Any] {
    [
        "role": stringAttr(element, kAXRoleAttribute as CFString),
        "title": stringAttr(element, kAXTitleAttribute as CFString),
        "identifier": stringAttr(element, kAXIdentifierAttribute as CFString),
        "description": stringAttr(element, kAXDescriptionAttribute as CFString),
    ]
}

func applicationElement(named name: String?) -> AXUIElement {
    if let name, !name.isEmpty {
        let match = NSWorkspace.shared.runningApplications.first {
            $0.localizedName?.localizedCaseInsensitiveCompare(name) == .orderedSame
                || ($0.bundleIdentifier ?? "").localizedCaseInsensitiveContains(name)
        }
        if let match {
            return AXUIElementCreateApplication(match.processIdentifier)
        }
    }
    if let front = NSWorkspace.shared.frontmostApplication {
        return AXUIElementCreateApplication(front.processIdentifier)
    }
    return AXUIElementCreateSystemWide()
}

func findElement(in root: AXUIElement, needle: String, limit: Int = 500) -> AXUIElement? {
    var queue: [AXUIElement] = [root]
    var seen = 0
    while !queue.isEmpty, seen < limit {
        let current = queue.removeFirst()
        seen += 1
        if seen > 1, elementMatches(current, needle: needle) {
            return current
        }
        if let children = attribute(current, kAXChildrenAttribute as CFString) as? [AXUIElement] {
            queue.append(contentsOf: Array(children.prefix(80)))
        }
    }
    return nil
}

func axActionName(_ command: String) -> String {
    switch command {
    case "ax.press", "ax.select":
        return kAXPressAction as String
    case "ax.focus":
        return kAXRaiseAction as String
    case "ax.expand":
        return kAXShowMenuAction as String
    case "ax.collapse":
        return kAXCancelAction as String
    case "ax.scroll":
        return "AXScrollToVisible"
    default:
        return kAXPressAction as String
    }
}

func performAction(_ identifier: String, action: String, value: String?, appName: String?) -> [String: Any] {
    let needle = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !needle.isEmpty else {
        return ["ok": false, "error": "missing_identifier"]
    }
    let root = applicationElement(named: appName)
    guard let element = findElement(in: root, needle: needle) else {
        return [
            "ok": false,
            "error": "ax_not_found",
            "identifier": needle,
            "requestedAction": action,
            "app": appName ?? "",
        ]
    }
    if action == "ax.setValue" {
        let focused = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        let set = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, (value ?? "") as CFTypeRef)
        let ok = set == .success || focused == .success
        return [
            "ok": ok,
            "error": ok ? "" : "ax_set_value_failed",
            "identifier": needle,
            "requestedAction": action,
            "matched": describeElement(element),
        ]
    }
    if action == "ax.focus" {
        _ = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    }
    let result = AXUIElementPerformAction(element, axActionName(action) as CFString)
    let ok = result == .success
    return [
        "ok": ok,
        "error": ok ? "" : "ax_action_failed",
        "identifier": needle,
        "requestedAction": action,
        "axCode": Int(result.rawValue),
        "matched": describeElement(element),
    ]
}

func systemWideInspect(maxDepth: Int, appName: String?) -> [String: Any] {
    if let appName, !appName.isEmpty {
        let match = NSWorkspace.shared.runningApplications.first {
            $0.localizedName?.localizedCaseInsensitiveCompare(appName) == .orderedSame
        }
        if let match {
            let appEl = AXUIElementCreateApplication(match.processIdentifier)
            return inspectElement(appEl, depth: 0, maxDepth: maxDepth)
        }
    }
    return inspectElement(AXUIElementCreateSystemWide(), depth: 0, maxDepth: maxDepth)
}

func captureScreen() -> [String: Any] {
    reexecDisclaimedIfNeeded()
    var result: [String: Any] = ["ok": false, "error": "capture_timeout"]
    let sem = DispatchSemaphore(value: 0)
    Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first else {
                result = ["ok": false, "error": "no_display"]
                sem.signal()
                return
            }
            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let config = SCStreamConfiguration()
            config.width = display.width
            config.height = display.height
            config.showsCursor = false
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
            let dir = NSTemporaryDirectory() + "nova-desktop-ephemeral/"
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            let path = dir + "capture-\(Int(Date().timeIntervalSince1970 * 1000)).png"
            let url = URL(fileURLWithPath: path)
            let uti = UTType.png.identifier as CFString
            guard let dest = CGImageDestinationCreateWithURL(url as CFURL, uti, 1, nil) else {
                result = ["ok": false, "error": "encode_failed"]
                sem.signal()
                return
            }
            CGImageDestinationAddImage(dest, image, nil)
            if !CGImageDestinationFinalize(dest) {
                result = ["ok": false, "error": "write_failed"]
                sem.signal()
                return
            }
            result = ["ok": true, "path": path, "ephemeral": true]
        } catch {
            let message = error.localizedDescription
            if message.lowercased().contains("not authorized") || message.lowercased().contains("denied") {
                result = ["ok": false, "permission": "screen_recording", "error": "PERMISSION_REQUIRED"]
            } else {
                result = ["ok": false, "error": message]
            }
        }
        sem.signal()
    }
    _ = sem.wait(timeout: .now() + 8)
    return result
}

func automationTrusted() -> Bool {
    let target = NSAppleEventDescriptor(bundleIdentifier: "com.apple.systemevents")
    let status = AEDeterminePermissionToAutomateTarget(
        target.aeDesc,
        typeWildCard,
        typeWildCard,
        false
    )
    return status == noErr
}

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

func launchApp(_ name: String) -> [String: Any] {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let candidates: [URL] = [
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: trimmed),
        URL(fileURLWithPath: "/System/Applications/\(trimmed).app"),
        URL(fileURLWithPath: "/Applications/\(trimmed).app"),
        URL(fileURLWithPath: "/System/Applications/Utilities/\(trimmed).app"),
        URL(fileURLWithPath: "/Applications/Utilities/\(trimmed).app"),
    ].compactMap { $0 }

    let appURL = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) })
        ?? NSWorkspace.shared.urlForApplication(toOpen: URL(fileURLWithPath: "/"))
    // Prefer explicit name lookup via LaunchServices when path guesses fail.
    let resolved: URL? = {
        if let appURL, FileManager.default.fileExists(atPath: appURL.path), appURL.path.hasSuffix(".app") {
            return appURL
        }
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        task.arguments = ["-e", "POSIX path of (path to application \"\(trimmed)\")"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = Pipe()
        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            return nil
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let path = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path)
    }()

    guard let target = resolved, FileManager.default.fileExists(atPath: target.path) else {
        return ["ok": false, "error": "app_not_found", "name": trimmed]
    }
    let configuration = NSWorkspace.OpenConfiguration()
    var launchError: String?
    let sem = DispatchSemaphore(value: 0)
    NSWorkspace.shared.openApplication(at: target, configuration: configuration) { _, error in
        launchError = error?.localizedDescription
        sem.signal()
    }
    _ = sem.wait(timeout: .now() + 6)
    return ["ok": launchError == nil, "name": trimmed, "path": target.path, "error": launchError ?? ""]
}

func focusApp(_ name: String) -> [String: Any] {
    let app = NSWorkspace.shared.runningApplications.first {
        $0.localizedName?.localizedCaseInsensitiveCompare(name) == .orderedSame
    }
    guard let app else { return ["ok": false, "error": "app_not_running", "name": name] }
    let ok = app.activate()
    return ["ok": ok, "name": name, "pid": app.processIdentifier]
}

func quitApp(_ name: String) -> [String: Any] {
    let app = NSWorkspace.shared.runningApplications.first {
        $0.localizedName?.localizedCaseInsensitiveCompare(name) == .orderedSame
    }
    guard let app else { return ["ok": false, "error": "app_not_running", "name": name] }
    let ok = app.terminate()
    return ["ok": ok, "name": name]
}

func windows() -> [[String: Any]] {
    let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
    guard let info = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    return info.prefix(80).map { item in
        [
            "name": item[kCGWindowName as String] ?? "",
            "owner": item[kCGWindowOwnerName as String] ?? "",
            "pid": item[kCGWindowOwnerPID as String] ?? 0,
            "layer": item[kCGWindowLayer as String] ?? 0,
            "bounds": item[kCGWindowBounds as String] ?? [:],
        ]
    }
}

let raw = CommandLine.arguments.dropFirst().joined(separator: " ")
guard let data = raw.data(using: .utf8), let command = try? JSONDecoder().decode(Command.self, from: data) else {
    writeJSON(["ok": false, "error": "invalid_command"])
    exit(1)
}

switch command.cmd {
case "permissions":
    let accessibility =
        getenv(tccAxResultEnv).map { String(cString: $0) == "1" } ?? axTrusted()
    reexecDisclaimedIfNeeded(extraEnv: [tccAxResultEnv: accessibility ? "1" : "0"])
    writeJSON([
        "ok": true,
        "data": [
            "accessibility": accessibility,
            "screenRecording": screenTrusted(),
            "automation": automationTrusted(),
        ],
    ])
case "apps":
    writeJSON(["ok": true, "data": ["running": listApps(), "installed": listInstalled()]])
case "windows":
    writeJSON(["ok": true, "data": ["windows": windows()]])
case "capture":
    writeJSON(captureScreen())
case "request.screen":
    reexecDisclaimedIfNeeded()
    writeJSON(["ok": requestScreenRecordingAccess(), "permission": "screen_recording"])
case "ax.inspect":
    if !axTrusted() {
        writeJSON(["ok": false, "permission": "accessibility", "error": "PERMISSION_REQUIRED"])
    } else {
        writeJSON(["ok": true, "data": systemWideInspect(maxDepth: command.maxDepth ?? 3, appName: command.app)])
    }
case "ax.press", "ax.focus", "ax.setValue", "ax.select", "ax.expand", "ax.collapse", "ax.scroll":
    if !axTrusted() {
        writeJSON(["ok": false, "permission": "accessibility", "error": "PERMISSION_REQUIRED"])
    } else {
        writeJSON(performAction(command.identifier ?? "", action: command.cmd, value: command.value, appName: command.app))
    }
case "app.launch":
    writeJSON(launchApp(command.app ?? ""))
case "app.focus":
    writeJSON(focusApp(command.app ?? ""))
case "app.quit":
    writeJSON(quitApp(command.app ?? ""))
case "automation.mail":
    writeJSON(mailAutomationState())
case "applescript.run":
    writeJSON(runAppleScript(command.script ?? command.value ?? ""))
default:
    writeJSON(["ok": false, "error": "unknown_cmd", "cmd": command.cmd])
    exit(1)
}
