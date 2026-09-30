import AppKit
import ApplicationServices
import AVFoundation

/// Sprechtaste: halten = NOVA hört zu, loslassen = NOVA antwortet. Gespeichert in UserDefaults „novaPushToTalkKey“.
enum Sprechtaste: String, CaseIterable {
    case rechteOption = "rightOption"
    case linkeOption = "leftOption"
    case rechteBefehl = "rightCommand"
    case fn = "fn"
    case f5 = "f5"

    static let schluessel = "novaPushToTalkKey"

    static var aktuell: Sprechtaste {
        get {
            let raw = UserDefaults.standard.string(forKey: schluessel) ?? ""
            return Sprechtaste.allCases.first { $0.rawValue.lowercased() == raw.lowercased() } ?? .rechteOption
        }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: schluessel) }
    }

    var name: String {
        switch self {
        case .rechteOption: return "rechte Option-Taste (⌥)"
        case .linkeOption: return "linke Option-Taste (⌥)"
        case .rechteBefehl: return "rechte Befehlstaste (⌘)"
        case .fn: return "Fn-Taste"
        case .f5: return "F5"
        }
    }

    var keyCode: UInt16 {
        switch self {
        case .rechteOption: return 61
        case .linkeOption: return 58
        case .rechteBefehl: return 54
        case .fn: return 63
        case .f5: return 96
        }
    }

    /// Modifier-Tasten melden sich als flagsChanged, normale Tasten als keyDown/keyUp.
    var istModifier: Bool { self != .f5 }

    func gehalten(_ flags: NSEvent.ModifierFlags) -> Bool {
        switch self {
        case .rechteOption, .linkeOption: return flags.contains(.option)
        case .rechteBefehl: return flags.contains(.command)
        case .fn: return flags.contains(.function)
        case .f5: return false
        }
    }
}

/// Die Sprechtaste wirkt auch, wenn NOVA nicht vorne ist. Dafür braucht macOS die Freigabe „Bedienungshilfen“.
enum Tastenfreigabe {
    private static let gefragtSchluessel = "novaTastenfreigabeGefragt"

    static var erteilt: Bool { AXIsProcessTrusted() }

    /// Beim ersten Start einmal den Systemdialog zeigen; danach nur noch über die Einstellungen.
    static func beimErstenStartAnfragen() {
        guard !erteilt, !UserDefaults.standard.bool(forKey: gefragtSchluessel) else { return }
        UserDefaults.standard.set(true, forKey: gefragtSchluessel)
        let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary)
    }

    static func systemeinstellungOeffnen() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }
}

final class EinstellungenWindowController: NSWindowController, NSWindowDelegate {
    private let tastenWahl = NSPopUpButton(frame: .zero, pullsDown: false)
    private let freigabeText = NSTextField(labelWithString: "")
    private let freigabeKnopf = NSButton(title: "Freigabe öffnen", target: nil, action: nil)
    private let mikrofonText = NSTextField(labelWithString: "")
    private var timer: Timer?
    private let onTasteGeaendert: () -> Void

    init(onTasteGeaendert: @escaping () -> Void) {
        self.onTasteGeaendert = onTasteGeaendert
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 230),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "NOVA – Einstellungen"
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.center()
        super.init(window: window)
        window.delegate = self
        window.contentView = baueAnsicht()
        aktualisiere()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func zeigen() {
        aktualisiere()
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in self?.aktualisiere() }
    }

    func windowWillClose(_ notification: Notification) {
        timer?.invalidate()
        timer = nil
    }

    private func baueAnsicht() -> NSView {
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 230))
        let tastenLabel = NSTextField(labelWithString: "Sprechtaste")
        tastenLabel.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        tastenWahl.addItems(withTitles: Sprechtaste.allCases.map(\.name))
        tastenWahl.selectItem(at: Sprechtaste.allCases.firstIndex(of: Sprechtaste.aktuell) ?? 0)
        tastenWahl.target = self
        tastenWahl.action = #selector(tasteGewaehlt)
        let hinweis = NSTextField(wrappingLabelWithString: "Taste halten und sprechen, loslassen – NOVA antwortet.")
        hinweis.textColor = .secondaryLabelColor
        hinweis.font = NSFont.systemFont(ofSize: 12)
        let freigabeLabel = NSTextField(labelWithString: "Bedienungshilfen")
        freigabeLabel.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        freigabeKnopf.target = self
        freigabeKnopf.action = #selector(freigabeOeffnen)
        let mikrofonLabel = NSTextField(labelWithString: "Mikrofon")
        mikrofonLabel.font = NSFont.systemFont(ofSize: 13, weight: .semibold)

        let raster = NSGridView(views: [
            [tastenLabel, tastenWahl],
            [NSGridCell.emptyContentView, hinweis],
            [freigabeLabel, freigabeText],
            [NSGridCell.emptyContentView, freigabeKnopf],
            [mikrofonLabel, mikrofonText],
        ])
        raster.rowSpacing = 10
        raster.columnSpacing = 14
        raster.column(at: 0).xPlacement = .trailing
        raster.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(raster)
        NSLayoutConstraint.activate([
            raster.topAnchor.constraint(equalTo: view.topAnchor, constant: 22),
            raster.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            raster.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -22),
            hinweis.widthAnchor.constraint(equalToConstant: 250),
        ])
        return view
    }

    private func aktualisiere() {
        if Tastenfreigabe.erteilt {
            freigabeText.stringValue = "erteilt – die Taste wirkt überall"
            freigabeText.textColor = .labelColor
            freigabeKnopf.isHidden = true
        } else {
            freigabeText.stringValue = "fehlt – die Taste wirkt nur, wenn NOVA vorne ist"
            freigabeText.textColor = .systemRed
            freigabeKnopf.isHidden = false
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: mikrofonText.stringValue = "erteilt"
        case .notDetermined: mikrofonText.stringValue = "wird beim ersten Sprechen abgefragt"
        default: mikrofonText.stringValue = "abgelehnt – in den Systemeinstellungen unter Mikrofon erlauben"
        }
    }

    @objc private func tasteGewaehlt() {
        let index = tastenWahl.indexOfSelectedItem
        guard Sprechtaste.allCases.indices.contains(index) else { return }
        Sprechtaste.aktuell = Sprechtaste.allCases[index]
        onTasteGeaendert()
    }

    @objc private func freigabeOeffnen() {
        Tastenfreigabe.systemeinstellungOeffnen()
    }
}
