# NOVA

Sprach-Oberfläche mit Gedächtnis auf dem Mac. Auftrag und Phasen: [docs/AUFTRAG.md](docs/AUFTRAG.md). Aktueller Stand: [docs/STAND.md](docs/STAND.md).

## Was der Code heute tut (Phase 1 bis 4)

- **Kopf** (`agents/master/`): Ein OpenAI-Modell (Responses API, Tool-Calling) bekommt pro Anfrage den Satz, bis zu 15 vorherige Nachrichten der aktiven Conversation (Fenster von 16 inkl. der aktuellen) und das Dauergedächtnis. Es entscheidet selbst, ob es ein Werkzeug aufruft. Kein Ersatzanbieter: Ist OpenAI nicht erreichbar, meldet NOVA den Fehler.
- **Werkzeuge** (`services/tools/`): `gedaechtnis_lesen`, `gedaechtnis_schreiben`, `mail_lesen`, `mail_entwurf`, `mail_antworten`, `mail_senden`, `freigabe_mail_dauer`, `vorlage_liste`, `vorlage_fuellen`, `kampagne_planen`, `kampagne_starten`, `kampagne_status`, `kampagne_abbrechen`, `kunden_suchen`, `freigabe_scanner_dauer`, `kontakt_hinzufuegen`, `kontaktliste_anzeigen`. Das Werkzeugprotokoll jeder Antwort (IDs, Status) wird mit der Nachricht gespeichert und geht im Verlauf mit.
- **Dauergedächtnis**: `~/Nova/gedaechtnis/firma.md`, `kunden.md`, `projekte.md` (Ordner per `NOVA_HOME` verschiebbar).
- **Oberfläche**: Orb, Gesprächszeile, Eingabe, Push-to-Talk (rechte Option-Taste im Launcher), Sprachausgabe.
- **Hintergrund-Läufer** (`services/worker/`): Queue mit Handlern `system.ping`, `mail.send` und `postfach.wache`. Beim Start meldet er laufende Kampagnen.
- **Kampagnen** (`services/kampagnen/`): Vorlage × Kontaktliste (`~/Nova/kampagnen/<name>.csv`, Spalte `email` Pflicht, weitere Spalten füllen die Platzhalter). Planen legt alle Entwürfe und eine Freigabe an; erst nach dem Ja startet die Kampagne: eine Mail pro Work-Item im eingestellten Abstand. Kampagnen-Mails gehen nur mit der Freigabe ihrer Kampagne raus. Nach der letzten Mail meldet NOVA sich; die Postfach-Wache prüft alle 5 Minuten (solange es Kampagnen-Mails der letzten 14 Tage gibt), ob ein Empfänger geantwortet hat, und legt einen Antwortentwurf vor – gesendet wird erst auf „senden“.
- **Kundensuche** (`services/leads/`, `lib/leads/scanner.ts`): startet Joachims Lead-Scanner (`/Volumes/ELEVUM/Projekte/joachim/lead-scanner`, per `NOVA_LEAD_SCANNER_DIR` änderbar) nach Freigabe als Worker-Job `scanner.lauf`, liest das Ergebnis in `Company`/`Contact` und als Kontaktliste `kunden-<branche>-<ort>-<datum>` ein und meldet sich. Nur Kunden, keine Sponsoren; gesendet wird dabei nichts. Details: `docs/SCRAPER.md`.
- **Kontaktlisten**: Sponsoren trägt NOVA auf Zuruf mit `kontakt_hinzufuegen` ein (Anrede „Sehr geehrter Herr …“ / „Sehr geehrte Frau …“ / „Sehr geehrtes …-Team“).
- **Kunden-Tagesbetrieb** (`services/tagesbetrieb/`, Einstellungen `~/Nova/tagesbetrieb.json`): werktags 08–17 Uhr, max. 50 Mails, alle 5 Minuten. Vorrat über den Scanner-Tageslauf (`src/daily.ts`, nur mit Dauerfreigabe `scanner.start`), jede Adresse geprüft (Form, MX/A-Eintrag, Sperrliste `~/Nova/kampagnen/sperrliste.txt`, Adresse/Firma nie zuvor angeschrieben). Morgens eine Beispiel-Mail zur Freigabe im Chat, danach eine Mail pro Takt. Nach Feierabend Tagesbericht im Chat und in `~/Nova/berichte/<datum>.md`.
- **Chatfenster** (`components/nova/NovaChat.tsx`, `/api/nova/chat`): ganzer Verlauf, aufklappbare Schritte je Antwort, Karten für Entwürfe und Kampagnen mit Freigabe-Knopf.
- **Meldungen** (`services/meldungen.ts`): Was NOVA von sich aus sagt (Kampagne fertig, Antwort eingegangen, Neustart), landet im Gespräch; die Oberfläche fragt alle 15 Sekunden nach, zeigt und spricht neue Meldungen und zeigt „arbeite: Kampagne x/y“.
- **Apple Mail** (`connectors/mail/apple.ts`): liest live den gemeinsamen Posteingang (höchstens 15 Mails je Abruf), sendet und antwortet über den Swift-Helfer (`services/desktop-service/native/main.swift`, Befehle `app.launch`, `automation.mail`, `applescript.run`). Gesendet gilt erst, wenn die Mail im Ordner „Gesendet“ des Absenderkontos gefunden wird. Absender nur aus `lib/mail/steerable.ts` (info@elevum.io, joachim@rankpilot.de; per `NOVA_MAIL_STEERABLE` änderbar).
- **Entwürfe** (`services/mail/entwuerfe.ts`): liegen in der Datenbank (`communications`), nicht in Apple Mail. Senden nur mit Einzelfreigabe für genau diesen Entwurf oder mit Dauerfreigabe `mail.send`; deren Tageslimit zählt nur tatsächlich gesendete Mails.
- **Signaturen**: `~/Nova/signaturen.txt` ordnet Absendern eine in Apple Mail gespeicherte Signatur zu (`adresse = Name`); sie wird beim Senden und Antworten gesetzt. Fehlt die Signatur in Apple Mail, scheitert der Versand sichtbar.
- **Vorlagen**: `~/Nova/vorlagen/<name>.md`, erste Zeile optional `Betreff: …`, Platzhalter `{{…}}`. Fehlende Werte werden gemeldet, nicht erfunden.

## Einrichten

```bash
cp .env.example .env   # OPENAI_API_KEY eintragen
npm install
npx prisma migrate dev
npx prisma db seed
```

## Starten

```bash
npm run macos:build    # baut macos/build/NOVA.app
```

Details zum Launcher: [macos/README.md](macos/README.md). Ohne App: `npm run dev` → http://127.0.0.1:3100.

## Prüfen

```bash
npm run typecheck
npm run lint
npm run test:kopf         # Kopf-Schleife mit geskriptetem Modell, ohne Netz, ohne App
npm run test:mail         # Mail-Werkzeuge mit Test-Postfach und Wegwerf-Datenbank, ohne Apple Mail
npm run test:kunden       # Kundensuche und Kontaktlisten mit Test-Scanner und Wegwerf-Datenbank
npm run test:tagesbetrieb # Tagesbetrieb: ein Arbeitstag mit Test-Tageslauf, Test-Postfach, Test-MX
npm run test:kampagne     # Kampagnen, Worker-Handler und Postfach-Wache mit Test-Postfach und Wegwerf-Datenbank
npm run nachweis:phase1   # echter API-Nachweis der vier Abnahmesätze (braucht OPENAI_API_KEY, nutzt temporären NOVA_HOME)
npm run nachweis:phase2   # Abnahmesätze Phase 2 gegen die echte API, mit Test-Postfach statt Apple Mail
npm run nachweis:phase4   # echter Lead-Scanner mit seiner Beispieldatei (keine API-Kosten) → Einlesen in NOVA
npm run nachweis:phase3   # Kampagne, Antwort-Wache, Ergänzen und Senden gegen die echte API, mit Test-Postfach
```
