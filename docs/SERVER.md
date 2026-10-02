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

## Stand (02.10., ~01:20)

Läuft auf dem Server:
- Web-App `nova-web` (pm2 von `nova`, aus `ecosystem.config.cjs`, TZ=Europe/Berlin) mit einer Kopie der Daten von 00:41. Kopf antwortet aus Gedächtnis und Verlauf.
- Lead-Scanner unter `/home/nova/projekte/lead-scanner` (eigener Google-Schlüssel in seiner `.env`, nur für `nova` lesbar); sein Test läuft auf dem Server grün.
- Claude Code 2.1.287 für `nova` installiert (`~/.local/bin/claude`) – **nicht angemeldet**.
- Sicherung jede Nacht 00:15 UTC (vor dem IONOS-Acronis-Backup um 01:06 UTC, das die ganze Platte in die Acronis-Cloud sichert) nach `~/sicherung/<datum>/`: Datenbank, `~/Nova`, Projekte; jede Sicherung wird nach dem Schreiben gelesen; 14 Tage. Erste Sicherung 02.10. 01:14 geprüft (3,3 GB).

Im Code (Zweig `server/umzug`), auf dem Server installiert, aber ohne echten Zugang noch nicht gelaufen:
- Mail über IMAP/SMTP (IONOS) statt Apple Mail – braucht die Passwörter und `~/Nova/mailkonten.txt`.
- Kalender über CalDAV statt Apple Kalender – braucht `~/Nova/kalender.json` und das Kalender-Passwort.
- Signaturen als Dateien `~/Nova/signaturen/<adresse>.txt` – Inhalt liefert Joachim (Apple Mail hängte sie bisher selbst an).

Läuft bewusst nicht:
- Hintergrund-Läufer `nova-worker` (sonst laufen Mac und Server gleichzeitig, Mails gingen doppelt raus).
- Live-Stellen von Webseite/App vom Server aus: Die Deploy-Skripte melden sich als root per SSH an; `nova` hat (richtig so) keinen root-Zugang. Lösung mit Joachim: fest installierte, root-eigene Deploy-Befehle, die `nova` per sudo-Regel genau so aufrufen darf – nicht die Skripte aus dem Projekt (die könnte Claude Code ändern).
- Browser für Plattform-Einträge (bleibt auf dem Mac, Joachim löst dort Captchas).

Aktualisieren vom Mac: `scripts/server/aktualisieren.sh` (überträgt, installiert, baut, startet laufende Prozesse neu – startet den Hintergrund-Läufer nie von selbst).

## Noch zu tun bis zum Umschalten

1. Joachim: Passwörter eintragen (`scripts/server/nova.sh passwort joachim@rankpilot.de`, `… check@b2b-rankpilot.de`, `… info@elevum.io`), Signaturtexte liefern; danach eine echte Test-Mail an seine Test-Adressen (auf Zuruf).
2. Joachim: Welcher Kalender (iCloud?), Apple-ID und App-Passwort (`nova.sh kalender-passwort`).
3. Joachim: Claude Code auf dem Server anmelden (`ssh nova@87.106.179.99`, dann `claude`).
4. Live-Stellen vom Server (siehe oben) gemeinsam einrichten.
5. NOVA.app auf dem Mac als Fernbedienung (spricht über SSH mit dem Server); Swift-Helfer und Apple-Teile im Launcher entfernen.
6. (erledigt 02.10.: Acronis sichert die ganze Platte jede Nacht außer Haus – wöchentlich voll, täglich inkrementell.)
7. Gleiche Node-Version auf Mac und Server (Mac 24, Server 22).
8. Umschalten an einem Abend: Mac-NOVA aus, letzte Daten übernehmen (`scripts/umzug-daten.ts`), Projekte nachgleichen, `pm2 start ecosystem.config.cjs`, `pm2 save` + Autostart.

rankPilot-Sicherungen (02.10. auf Joachims Wort korrigiert):
- Uploads: Die Sicherung suchte in /var/data/rankpilot-uploads (geplante Verlegung nie gemacht) und scheiterte täglich. Jetzt `/etc/cron.d/rankpilot-backup-uploads` mit `RP_UPLOADS_DATA_DIR=/var/www/rankpilot/uploads`, 14 Tage Aufbewahrung; erster Lauf 417/417 Dateien. Alte Fassung: `/root/rankpilot-backup-uploads.cron.vor-nova-20261002`. Skript im rankPilot-Repo unverändert.
- „Nur auf demselben Server“ stimmte nicht: Acronis sichert die ganze Platte jede Nacht in die Acronis-Cloud. Die Datenbank-Sicherung (vorher 02:00 UTC) lief aber nach Acronis (01:06 UTC) und kam erst einen Tag später in die Cloud – jetzt 00:30 UTC, Uploads 00:45 UTC, NOVA 00:15 UTC. Alte root-crontab: `/root/crontab.vor-nova-20261002`.
