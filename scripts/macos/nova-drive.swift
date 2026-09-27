import ApplicationServices
import AppKit
import Foundation

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success else { return nil }
  return value
}
func str(_ el: AXUIElement, _ name: String) -> String { attr(el, name) as? String ?? "" }
func kids(_ el: AXUIElement) -> [AXUIElement] { attr(el, kAXChildrenAttribute as String) as? [AXUIElement] ?? [] }
func find(_ el: AXUIElement, where pred: (AXUIElement) -> Bool) -> AXUIElement? {
  if pred(el) { return el }
  for child in kids(el) { if let hit = find(child, where: pred) { return hit } }
  return nil
}
func findAll(_ el: AXUIElement, where pred: (AXUIElement) -> Bool) -> [AXUIElement] {
  var out: [AXUIElement] = []
  if pred(el) { out.append(el) }
  for child in kids(el) { out.append(contentsOf: findAll(child, where: pred)) }
  return out
}

func visibleLines(_ win: AXUIElement) -> [String] {
  findAll(win, where: { str($0, kAXRoleAttribute as String) == "AXStaticText" })
    .map { str($0, kAXValueAttribute as String).trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
}

func openNova() -> (pid_t, AXUIElement, AXUIElement) {
  guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "io.elevum.nova").first
    ?? NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == "NOVA" }) else {
    fputs("NOVA.app nicht gefunden\n", stderr)
    exit(2)
  }
  let pid = app.processIdentifier
  app.activate(options: [])
  usleep(250_000)
  let axApp = AXUIElementCreateApplication(pid)
  _ = AXUIElementSetAttributeValue(axApp, "AXManualAccessibility" as CFString, kCFBooleanTrue)
  _ = AXUIElementSetAttributeValue(axApp, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
  usleep(350_000)
  guard let windows = attr(axApp, kAXWindowsAttribute as String) as? [AXUIElement], let win = windows.first else {
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


func ensureConversationOpen(_ win: AXUIElement) {
  let hasJoachim = visibleLines(win).contains(where: { $0 == "JOACHIM" })
  if hasJoachim { return }
  if let btn = find(win, where: {
    str($0, kAXRoleAttribute as String) == "AXButton" && str($0, kAXTitleAttribute as String).contains("Gespräch")
  }) {
    _ = AXUIElementPerformAction(btn, kAXPressAction as CFString)
    usleep(400_000)
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

let deadline = Date().addingTimeInterval(timeout)
var last: [String] = []
while Date() < deadline {
  usleep(400_000)
  last = visibleLines(win)
  let busy = last.contains(where: {
    $0.localizedCaseInsensitiveContains("denke") ||
      $0.localizedCaseInsensitiveContains("arbeitet") ||
      $0.localizedCaseInsensitiveContains("NOVA spricht") ||
      $0.localizedCaseInsensitiveContains("schaue") ||
      $0.localizedCaseInsensitiveContains("Postfach") && $0.localizedCaseInsensitiveContains("Ich ") ||
      $0 == "…" || $0 == "..."
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
