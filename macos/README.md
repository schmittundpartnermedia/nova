# NOVA.app

Native macOS-Launcher-App für den lokalen NOVA-Start.

## Architektur

```
NOVA.app
  → Process Supervisor
    → NOVA Application Service  (Next.js, später Production-Build)
    → Desktop Service           (127.0.0.1:47821)
    → Native Helper             (bestehendes signiertes Helper-Bundle)
  → NOVA UI                     (bestehende Oberfläche, kein neues Frontend)
```

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

## Finales App-Icon

Der Build erzeugt nur dann ein neutrales Placeholder-Icon, wenn noch keine Icon-Quellen liegen.

**Finales Icon hier einsetzen:**

1. Quelldateien: `macos/launcher/Resources/AppIcon.iconset/`
   - Pflicht für Retina: `icon_512x512@2x.png` (1024×1024)
   - zusätzlich die Standardgrößen `icon_16x16.png` bis `icon_512x512.png` samt `@2x`
2. Danach `npm run macos:build` ausführen.
3. Die gebaute Datei liegt in `NOVA.app/Contents/Resources/AppIcon.icns`.

Kein Fantasie-Logo im Placeholder. Einfach ein graues abgerundetes Quadrat ersetzen.

## Logs

Lokal, ohne Secrets:

- `.nova/logs/launcher.log`
- `.nova/logs/nova-web.log`
- `.nova/logs/desktop-service.log`

## Beenden

NOVA.app beendet nur Prozesse, die diese Session selbst gestartet hat. Bereits laufende gesunde Dienste werden wiederverwendet und beim Quit nicht angefasst.
