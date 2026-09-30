# NOVA

Sprach-Oberfläche mit Gedächtnis auf dem Mac. Auftrag und Phasen: [docs/AUFTRAG.md](docs/AUFTRAG.md). Aktueller Stand: [docs/STAND.md](docs/STAND.md).

## Was der Code heute tut (Phase 1 und 2)

- **Kopf** (`agents/master/`): Ein OpenAI-Modell (Responses API, Tool-Calling) bekommt pro Anfrage den Satz, bis zu 15 vorherige Nachrichten der aktiven Conversation (Fenster von 16 inkl. der aktuellen) und das Dauergedächtnis. Es entscheidet selbst, ob es ein Werkzeug aufruft. Kein Ersatzanbieter: Ist OpenAI nicht erreichbar, meldet NOVA den Fehler.
- **Werkzeuge** (`services/tools/`): `gedaechtnis_lesen`, `gedaechtnis_schreiben`, `mail_lesen`, `mail_entwurf`, `mail_antworten`, `mail_senden`, `freigabe_mail_dauer`, `vorlage_liste`, `vorlage_fuellen`. Das Werkzeugprotokoll jeder Antwort (IDs, Status) wird mit der Nachricht gespeichert und geht im Verlauf mit.
- **Dauergedächtnis**: `~/Nova/gedaechtnis/firma.md`, `kunden.md`, `projekte.md` (Ordner per `NOVA_HOME` verschiebbar).
- **Oberfläche**: Orb, Gesprächszeile, Eingabe, Push-to-Talk (rechte Option-Taste im Launcher), Sprachausgabe.
- **Hintergrund-Läufer** (`services/worker/`): Queue mit Handlern `system.ping` und `mail.send`.
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
npm run nachweis:phase1   # echter API-Nachweis der vier Abnahmesätze (braucht OPENAI_API_KEY, nutzt temporären NOVA_HOME)
npm run nachweis:phase2   # Abnahmesätze Phase 2 gegen die echte API, mit Test-Postfach statt Apple Mail
```
