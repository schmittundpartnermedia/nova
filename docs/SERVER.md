# NOVA auf dem Server (Umzug, Stand 02.10.2026)

Server: IONOS VPS 87.106.179.99 (Ubuntu 24.04, 12 Kerne, 24 GB, 720 GB). Auf demselben Server laufen die Live-Seiten (rankpilot.de, app.rankpilot.de, dn-masterclass, pb-pflegekonzept, elevum, tm22) unter root/pm2 – die werden vom Umzug nicht angefasst.

## Trennung

| Teil | Wo | Wer |
|---|---|---|
| Live-Seiten | `/var/www/*`, pm2 von root | root |
| NOVA | `/home/nova/nova`, eigenes pm2 | Benutzer `nova`, kein sudo |
| NOVAs Daten (Gedächtnis, Vorlagen, Listen …) | `/home/nova/Nova` (ohne Browser-Profil) | `nova` |
| Projekte (Werkstatt) | `/home/nova/projekte/<projekt>` | `nova` |
| NOVAs Datenbank | eigener Postgres-Dienst `16/nova`, Port 5433, nur 127.0.0.1 | Rolle `nova` |
| rankPilot-Datenbank | Postgres-Dienst `16/main`, Port 5432 | – `nova` hat dort keine Rolle |

Geprüft: `nova` kann `/var/www` und die `.env` der Live-Seiten nicht lesen, kommt nicht an die rankPilot-Datenbank, hat kein sudo.

Firewall (ufw, seit 02.10.): eingehend nur 22, 80, 443. Davor zusätzlich die IONOS-Firewall. NOVA hört nur auf 127.0.0.1:3100.

## Steuerung vom Mac

```
scripts/server/nova.sh status    # läuft alles?
scripts/server/nova.sh logs      # Protokoll live
scripts/server/nova.sh stop      # Notschalter (nur NOVA, nicht die Live-Seiten)
scripts/server/nova.sh start
scripts/server/nova.sh oeffnen   # NOVA im Browser auf dem Mac (über SSH, nichts ist offen im Internet)
```

Anmeldung als `nova` mit dem SSH-Schlüssel des Macs (`~/.ssh/id_ed25519`). Cursor: „Remote-SSH: Connect to Host“ → `nova@87.106.179.99` → Ordner `/home/nova/projekte/<projekt>`.

## Projekte

Auf dem Server (Stand 02.10., 00:52, Git-Stand und Dateizahl mit der ELEVUM verglichen, gleich): adfiltec, diekuehlenretter, DN-masterclass, ELEVUM, lead-scanner, PandB-Pflegekonzept, planexus, Projekt-seedance-studio, rankPilot-app, rankpilot-website. Ohne `.env` (enthalten Live-Zugänge; werden gezielt je Programm nachgetragen) und ohne `node_modules`.
Nicht hoch (Joachims Entscheidung): Wichtiges, ZIP-daten-replit-prjekte, rankPilot-server-backup, Projekt OverPark, rankPilot (alte Kopie). Die ELEVUM bleibt unverändert, bis alles oben läuft.
Die Kopien sind ein Stand von heute Nacht; bis zum Umschalten wird unten weitergearbeitet, beim Umschalten wird nachgeglichen.

## Datenbank

Postgres statt SQLite (Zweig `server/umzug`). Datenübernahme `scripts/umzug-daten.ts`: liest eine SQLite-Kopie, schreibt in einer Transaktion, vergleicht jede Zeile Feld für Feld. Für die Übernahme braucht die Rolle `nova` kurz Superuser (Fremdschlüssel aussetzen), danach wieder entzogen.

## Stand der Probe (02.10., ~01:00)

- Läuft: Web-App unter pm2 (`nova-web`), Kopie der Daten von 00:41, Kopf antwortet aus Gedächtnis und Verlauf.
- Läuft **nicht**: Hintergrund-Läufer (bewusst – sonst gingen Mails doppelt raus, solange der Mac die echte NOVA ist), Mail (Apple Mail gibt es auf dem Server nicht), Kalender, Claude-Aufträge, Lead-Scanner, Browser für Plattform-Einträge (bleibt auf dem Mac).
- Nicht dauerhaft: Nach einem Neustart des Servers startet die Probe nicht von selbst.

## Noch zu tun bis zum Umschalten

1. Mail direkt über IONOS (IMAP/SMTP) statt Apple Mail – Passwörter trägt Joachim selbst ein.
2. Kalender über iCloud (CalDAV) statt Apple Kalender – App-Passwort von Joachim.
3. Claude Code auf dem Server installieren und anmelden (Joachim); Projektpfade auf `/home/nova/projekte`; Live-Stellen nur über die Deploy-Skripte, nach Joachims Ja.
4. Lead-Scanner auf dem Server (Google-Schlüssel gezielt nachtragen).
5. NOVA.app auf dem Mac als Fernbedienung (spricht mit dem Server).
6. Sicherung: NOVA-Datenbank und `/home/nova` jede Nacht, dazu eine Kopie außer Haus. Prüfen, ob das IONOS-Backup (Acronis) gebucht ist.
7. Gleiche Node-Version auf Mac und Server (Mac 24, Server 22 – Lockfile wich ab).
8. Umschalten mit Joachim an einem Abend: Mac-NOVA aus, letzte Daten übernehmen, Server-Worker an.

Gefunden nebenbei (rankPilot, nicht angefasst): Die tägliche Sicherung der Uploads scheitert jeden Tag („/var/data/rankpilot-uploads fehlt“); die Datenbank-Sicherungen liegen nur auf demselben Server.
