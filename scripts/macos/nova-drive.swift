import ApplicationServices
import AppKit
import Foundation
import CoreGraphics

let maxDepth = 48

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
  return value
}
func str(_ el: AXUIElement, _ name: String) -> String { attr(el, name) as? String ?? "" }
func kids(_ el: AXUIElement) -> [AXUIElement] {
  attr(el, kAXChildrenAttribute as String) as? [AXUIElement] ?? []
}

func find(_ root: AXUIElement, where pred: (AXUIElement) -> Bool) -> AXUIElement? {
  var queue: [(AXUIElement, Int)] = [(root, 0)]
  var index = 0
  while index < queue.count {
    let (el, depth) = queue[index]
    index += 1
    if pred(el) { return el }
    if depth >= maxDepth { continue }
    for child in kids(el) {
      queue.append((child, depth + 1))
    }
    if queue.count > 8000 { break }
  }
  return nil
}

func findAll(_ root: AXUIElement, where pred: (AXUIElement) -> Bool) -> [AXUIElement] {
  var out: [AXUIElement] = []
  var queue: [(AXUIElement, Int)] = [(root, 0)]
  var index = 0
  while index < queue.count {
    let (el, depth) = queue[index]
    index += 1
    if pred(el) { out.append(el) }
    if depth >= maxDepth { continue }
    for child in kids(el) {
      queue.append((child, depth + 1))
    }
    if queue.count > 12000 { break }
  }
  return out
}

func visibleLines(_ win: AXUIElement) -> [String] {
  findAll(win, where: { str($0, kAXRoleAttribute as String) == "AXStaticText" })
    .prefix(400)
    .map { str($0, kAXValueAttribute as String).trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
}

func cgFocusNovaWindow() {
  let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
  guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return }
  for w in info {
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    guard owner == "NOVA", let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    let target = CGRect(x: b["X"]!, y: b["Y"]!, width: b["Width"]!, height: b["Height"]!)
    let screenH = NSScreen.screens.map { $0.frame.maxY }.max() ?? 1080
    let click = CGPoint(x: target.midX, y: screenH - target.midY)
    let src = CGEventSource(stateID: .hidSystemState)
    if let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: click, mouseButton: .left),
       let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: click, mouseButton: .left) {
      down.post(tap: .cghidEventTap)
      usleep(30_000)
      up.post(tap: .cghidEventTap)
    }
    break
  }
}

func openNova() -> (pid_t, AXUIElement, AXUIElement) {
  guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "io.elevum.nova").first
    ?? NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == "NOVA" }) else {
    fputs("NOVA.app nicht gefunden\n", stderr)
    exit(2)
  }
  let pid = app.processIdentifier
  app.activate(options: [.activateAllWindows])
  usleep(200_000)
  cgFocusNovaWindow()
  usleep(250_000)
  let axApp = AXUIElementCreateApplication(pid)
  _ = AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  _ = AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
  usleep(500_000)
  var win: AXUIElement?
  for _ in 0..<20 {
    if let windows = attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement] {
      win = windows.first(where: { str($0, kAXRoleAttribute as String) == "AXWindow" }) ?? windows.first
      if let win, str(win, kAXRoleAttribute as String) == "AXWindow" { break }
    }
    if let childWin = find(axApp, where: { str($0, kAXRoleAttribute as String) == "AXWindow" }) {
      win = childWin
      break
    }
    usleep(300_000)
    cgFocusNovaWindow()
  }
  guard let win else {
    fputs("Kein NOVA-Fenster\n", stderr)
    exit(3)
  }
  _ = AXUIElementPerformAction(win, kAXRaiseAction as CFString)
  return (pid, axApp, win)
}

func textField(_ win: AXUIElement) -> AXUIElement {
  if let field = find(win, where: {
    str($0, kAXRoleAttribute as String) == "AXTextField" &&
      str($0, "AXPlaceholderValue").localizedCaseInsensitiveContains("Was kann ich")
  }) { return field }
  if let field = find(win, where: { str($0, kAXRoleAttribute as String) == "AXTextField" }) { return field }
  fputs("Eingabefeld nicht gefunden\n", stderr)
  exit(4)
}

func conversationOpen(_ win: AXUIElement) -> Bool {
  visibleLines(win).contains(where: { $0 == "JOACHIM" })
}

func ensureConversationOpen(_ win: AXUIElement) {
  if conversationOpen(win) { return }
  for _ in 0..<8 {
    if conversationOpen(win) { return }
    if let btn = find(win, where: {
      str($0, kAXRoleAttribute as String) == "AXButton" &&
        (str($0, kAXTitleAttribute as String) == "Aktuelles Gespräch öffnen" ||
         str($0, kAXDescriptionAttribute as String) == "Aktuelles Gespräch öffnen")
    }) {
      _ = AXUIElementPerformAction(btn, kAXPressAction as CFString)
      usleep(700_000)
      continue
    }
    usleep(300_000)
  }
}

func sendButton(_ win: AXUIElement) -> AXUIElement {
  guard let send = find(win, where: {
    str($0, kAXRoleAttribute as String) == "AXButton" && str($0, kAXTitleAttribute as String) == "Senden"
  }) else {
    fputs("Senden-Button nicht gefunden\n", stderr)
    exit(5)
  }
  return send
}

func clickSection(_ win: AXUIElement, title: String) -> Bool {
  guard let button = find(win, where: {
    str($0, kAXRoleAttribute as String) == "AXButton" && str($0, kAXTitleAttribute as String) == title
  }) else { return false }
  return AXUIElementPerformAction(button, kAXPressAction as CFString) == .success
}

let args = Array(CommandLine.arguments.dropFirst())
let command = args.first ?? "send"
let rest = Array(args.dropFirst())

let (_, _, win) = openNova()

if command == "read" {
  for line in visibleLines(win) { print(line) }
  exit(0)
}

if command == "section" {
  let title = rest.first ?? ""
  guard clickSection(win, title: title) else {
    fputs("Sektion nicht gefunden: \(title)\n", stderr)
    exit(7)
  }
  usleep(400_000)
  for line in visibleLines(win) { print(line) }
  exit(0)
}

if command == "voice-toggle" {
  let labelOn = "NOVA Stimme an"
  let labelOff = "NOVA Stimme aus"
  guard let btn = find(win, where: {
    str($0, kAXRoleAttribute as String) == "AXButton" &&
      (str($0, kAXTitleAttribute as String) == labelOn || str($0, kAXTitleAttribute as String) == labelOff)
  }) else {
    fputs("Stimmenschalter nicht gefunden\n", stderr)
    exit(8)
  }
  let before = str(btn, kAXTitleAttribute as String)
  _ = AXUIElementPerformAction(btn, kAXPressAction as CFString)
  usleep(300_000)
  let after = str(btn, kAXTitleAttribute as String)
  print("before=\(before)")
  print("after=\(after)")
  exit(0)
}

let message = command == "send" ? (rest.first ?? "Hallo") : command
let expect = (command == "send" ? Array(rest.dropFirst()) : rest).first ?? ""
let timeout = Double((command == "send" ? Array(rest.dropFirst(2)) : Array(rest.dropFirst())).first ?? "45") ?? 45

ensureConversationOpen(win)
let field = textField(win)
var setOk = false
for _ in 0..<40 {
  _ = AXUIElementSetAttributeValue(field, kAXFocusedAttribute as CFString, kCFBooleanTrue)
  let setErr = AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, message as CFString)
  if setErr == .success && str(field, kAXValueAttribute as String) == message {
    setOk = true
    break
  }
  usleep(250_000)
}
if !setOk {
  fputs("Konnte Eingabefeld nicht setzen\n", stderr)
  exit(9)
}
print("SENT \(message)")
_ = AXUIElementPerformAction(sendButton(win), kAXPressAction as CFString)
usleep(400_000)
ensureConversationOpen(win)

let deadline = Date().addingTimeInterval(timeout)
var last: [String] = []
while Date() < deadline {
  usleep(400_000)
  if !conversationOpen(win) {
    ensureConversationOpen(win)
  }
  last = visibleLines(win)
  let busy = last.contains(where: {
    let s = $0.trimmingCharacters(in: .whitespacesAndNewlines)
    let low = s.lowercased()
    if s == "…" || s == "..." { return true }
    if low == "denken" || low == "planen" || low == "umsetzen" { return false }
    return low.contains("ich denke") ||
      low.contains("nova denkt") ||
      low.contains("nova arbeitet") ||
      low.contains("arbeitet noch") ||
      low.contains("nova spricht") ||
      low.contains("ich schaue") ||
      (low.contains("postfach") && low.contains("ich "))
  })
  let hasUser = last.contains(where: { $0 == message || $0.contains(message) })
  let needles = expect.split(separator: "|").map { String($0) }.filter { !$0.isEmpty }
  let hasExpect = needles.isEmpty
    ? last.contains(where: {
      $0 != message &&
        $0.count > 4 &&
        !$0.localizedCaseInsensitiveContains("Bereit für deine Anfrage") &&
        !$0.localizedCaseInsensitiveContains("AKTIVE PROJEKTE") &&
        !$0.localizedCaseInsensitiveContains("NÄCHSTE AUFGABE") &&
        !$0.localizedCaseInsensitiveContains("AKTUELLER AUFTRAG") &&
        !$0.localizedCaseInsensitiveContains("DEIN") &&
        !$0.localizedCaseInsensitiveContains("BUSINESS") &&
        !$0.localizedCaseInsensitiveContains("ASSISTANT") &&
        $0 != "NOVA" &&
        $0 != "JOACHIM" &&
        $0 != "active" &&
        $0 != "open" &&
        $0 != "Erledigt."
    })
    : last.contains(where: { line in needles.contains(where: { line.localizedCaseInsensitiveContains($0) }) })
  if hasUser && hasExpect && !busy {
    print("OK")
    print("---VISIBLE---")
    for line in last { print(line) }
    print("---END---")
    exit(0)
  }
}
print("TIMEOUT")
print("---VISIBLE---")
for line in last { print(line) }
print("---END---")
exit(6)
