# NOVA

Sprach-Oberfläche mit Gedächtnis auf dem Mac. Auftrag und Phasen: [docs/AUFTRAG.md](docs/AUFTRAG.md). Aktueller Stand: [docs/STAND.md](docs/STAND.md).

## Was der Code heute tut (Phase 1)

- **Kopf** (`agents/master/`): Ein OpenAI-Modell (Responses API, Tool-Calling) bekommt pro Anfrage den Satz, bis zu 15 vorherige Nachrichten der aktiven Conversation (Fenster von 16 inkl. der aktuellen) und das Dauergedächtnis. Es entscheidet selbst, ob es ein Werkzeug aufruft. Kein Ersatzanbieter: Ist OpenAI nicht erreichbar, meldet NOVA den Fehler.
- **Werkzeuge** (`services/tools/`): nur `gedaechtnis_lesen` und `gedaechtnis_schreiben`.
- **Dauergedächtnis**: `~/Nova/gedaechtnis/firma.md`, `kunden.md`, `projekte.md` (Ordner per `NOVA_HOME` verschiebbar).
- **Oberfläche**: Orb, Gesprächszeile, Eingabe, Push-to-Talk (rechte Option-Taste im Launcher), Sprachausgabe.
- **Hintergrund-Läufer** (`services/worker/`): Queue mit Handlern `system.ping` und `mail.send`.
- **Apple Mail**: Anbindung über den Swift-Helfer (`services/desktop-service/native/main.swift`, Befehle `app.launch`, `automation.mail`, `applescript.run`). Der Kopf hat in Phase 1 keinen Zugriff darauf.

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
npm run nachweis:phase1   # echter API-Nachweis der vier Abnahmesätze (braucht OPENAI_API_KEY, nutzt temporären NOVA_HOME)
```
