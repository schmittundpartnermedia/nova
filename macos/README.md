# NOVA.app

Native macOS-Launcher-App für den lokalen NOVA-Start.

## Architektur

```
NOVA.app
  → Process Supervisor
    → CHECKING_ENVIRONMENT
    → CHECKING_VOLUME
    → CHECKING_RUNTIME
    → Application Service  (Next.js, Health: /api/nova/ready)
    → Desktop Service      (127.0.0.1:47821 /health)
    → Native Helper        (bestehendes signiertes Helper-Bundle)
  → NOVA UI                (bestehende Oberfläche, kein neues Frontend)
```

NOVA.app startet nach einem Mac-Neustart ohne Terminal. Die Runtime kommt aus `NOVANodeBin` (`/usr/local/bin/node`), nicht aus einer Login-Shell. Liegt das Projekt auf einem externen Volume, wartet der Supervisor auf Mount und Lesbarkeit, statt blind zu schlafen.

Der Helper bleibt ein eigenes Bundle unter:

`services/desktop-service/native/bin/NOVA Desktop Helper.app`

Er wird nicht in NOVA.app verschoben, damit bestehende TCC-Einträge (Screen Recording, Accessibility) erhalten bleiben.

## Entwicklung vs. Production

Aktuell startet der Launcher den Entwicklungsmodus über das bestehende Projekt:

`/Volumes/My Book 24/NOVA`

Gesteuert über `macos/launcher/Resources/LaunchConfig.plist`:

- `NOVALaunchMode=development` → `next dev`
- `NOVALaunchMode=production` → `next start` oder `.next/standalone/server.js`, falls vorhanden
- `NOVAStartAtLogin=false` → Autostart bei macOS-Login ist vorbereitet, aber absichtlich nicht aktiv

Später kann eine paketierte Version denselben Supervisor nutzen, ohne diesen Entwicklungsordner. Dafür `NOVAProjectRoot` auf das gebündelte Ressourcenverzeichnis setzen und `NOVALaunchMode=production` verwenden.

## Bauen

```bash
npm run macos:build
```

Ergebnis:

`/Volumes/My Book 24/NOVA/macos/build/NOVA.app`

Bundle Identifier: `io.elevum.nova`

## App-Icon

Aktuelles Icon: Navy-Quadrat mit Cyan-Aura und der Schrift **NOVA**, in den Farben der Oberfläche.

**Dateien:**

- Generator: `macos/launcher/scripts/generate-app-icon.swift`
- Quell-PNGs: `macos/launcher/Resources/AppIcon.iconset/`
- Gebautes Icon: `macos/build/NOVA.app/Contents/Resources/AppIcon.icns`

Ein späteres finales Artwork einfach als `icon_512x512@2x.png` (1024×1024) plus die übrigen Größen in `AppIcon.iconset/` ablegen und `npm run macos:build` ausführen. Wenn der Generator nicht überschreiben soll, `generate-app-icon.swift` im Build-Skript auskommentieren.

## Logs

Lokal, ohne Secrets:

- `.nova/logs/launcher.log`
- `.nova/logs/nova-web.log`
- `.nova/logs/desktop-service.log`

Startfehler nennen den Supervisor-Zustand, PID, Executable, cwd und den letzten Logausschnitt. Secrets werden redigiert.

## Beenden

NOVA.app beendet nur Prozesse, die diese Session selbst gestartet hat. Bereits laufende gesunde Dienste werden wiederverwendet und beim Quit nicht angefasst.
