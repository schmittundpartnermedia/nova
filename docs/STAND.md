# NOVA – Stand der Arbeit

Diese Datei ist die Übergabe zwischen Sitzungen. Wer hier anfängt (Claude Code, Cursor, Mensch), liest zuerst `docs/AUFTRAG.md`, dann diese Datei. Am Ende jeder Sitzung wird diese Datei aktualisiert – ehrlich, kurz, mit Datum.

## Rollen

- **Joachim** – Auftraggeber. Gibt die Vision, nimmt jede Phase in NOVA.app ab. Baut und testet nicht selbst.
- **Claude (claude.ai-Chat)** – Kontrolle. Prüft den Code auf GitHub gegen den Auftrag, schreibt Aufträge und diese Datei. Ändert keinen Code.
- **Claude Code / Cursor am Mac** – baut. Arbeitet nur die Phase, die hier als „dran" steht. Pusht nach jedem Schritt.

## Chronik

**28.09.2026** – Claude hat das Repo (Stand d162ba9) vollständig geprüft. Ergebnis: einzelne Bausteine echt (Apple-Mail-Versand, Websuche, Sprache, Worker, Push-to-Talk, Kontakte aus Recherche, `mail.send`-Handler, zentrale Freigabefunktion), aber kein Kopf: Nutzersätze werden per Regex verteilt, Modell nur als Fallback; Gesprächsverlauf geht nicht mit; Klick-/Bildschirm-Steuerung angefangen, unfertig, umgeht Freigaben. Tests wurden ans Ist-Verhalten angepasst, Doku behauptet mehr als der Code hält. Details in der Prüfung vom 28.09. (Chat), Kurzfassung: `docs/AUFTRAG.md` Abschnitt 3 „Behalten / Löschen".

**29.09.2026, nachts** – Vision neu gefasst: Nova ist Orchestrator über die vorhandenen Systeme (Mail, Scraper, Cursor, Seedance), nicht Bildschirm-Bedienerin. Auftrag v2 in 6 Phasen geschrieben (`docs/AUFTRAG.md`). Regel: pro Phase ein neuer Chat, Abnahme nur durch Joachim in NOVA.app.

**29.09.2026, tagsüber** – Cursor hat mit Phase 1 begonnen und wollte anschließend Phase 2 beginnen. Stand auf GitHub um 15:35: **nichts gepusht seit d162ba9** (28.09. 23:38). Was Cursor gebaut hat, liegt nur lokal. Nicht geprüft.

**29.09.2026, Claude Code übernimmt** – Cursors lokale Commits (7c7db0d Phase 1, 2bef5e2 Launcher-Pfad, 823650d Phase 2) waren committed, aber nicht gepusht; zusammen mit Auftrag/Stand unter `docs/` gepusht (9056b38).

Prüfung Phase 1 gegen den Auftrag – **Urteil: aufbauen, nicht neu.**
- Tragfähig: Kopf `agents/master/head.ts` (Responses-API-Schleife, max. 10 Werkzeugrunden, Werkzeuge nur aus `services/tools/registry.ts`), `agents/master/index.ts` gibt die letzten 16 Nachrichten der Conversation mit, Dauergedächtnis `lib/gedaechtnis/` lädt `firma.md`/`kunden.md`/`projekte.md` bei jeder Anfrage in den Systemprompt, Werkzeuge `gedaechtnis_lesen`/`_schreiben`. `tsc --noEmit` grün. `docs/nachweis-phase1-kopf.txt` zeigt die vier Abnahmesätze gegen die echte API (ohne App, ohne Mikrofon).
- Nicht fertig: Löschliste nur teilweise abgearbeitet – übrig u. a. 7× `agents/*/intent.ts` samt Agenten, `lib/*/intent.ts` (Regex), `lib/computer/` (16 Dateien), `services/computer/`, Seitenleisten `NovaSidebar`/`NovaContextPanel`, `three` in `package.json`, alte Doku unter `docs/`. Kein Mock-Regressionstest für den Kopf.
- Regelverstoß: 823650d ist Phase 2 (Mail-Werkzeuge im Kopf), begonnen vor der Phase-1-Abnahme. Wird zurückgenommen (`git revert`), der Code bleibt in der Historie für Phase 2.

**29.09.2026, nachmittags – Phase 1 zu Ende gebaut (Claude Code), Abnahme durch Joachim steht aus.**

Was jetzt real im Code steht (nachgewiesen wie angegeben):
- Kopf: nur OpenAI (`providers/ai/head.ts`), Modell `gpt-6-astra` (Default, Override über `AiProviderConfig` role „master"). Mock-, Anthropic- und Local-Anbieter gelöscht; es gibt **keinen** Ersatzanbieter mehr – vorher fiel NOVA bei OpenAI-Ausfall still auf einen Regex-Mock zurück.
- Werkzeuge im Kopf: nur `gedaechtnis_lesen` (zählt nicht als ausgeführt) und `gedaechtnis_schreiben`.
- Schleife: max. 8 Werkzeugrunden; wenn erschöpft, sagt NOVA das, statt „Erledigt." zu behaupten.
- Modellnamen gegen `models.list` des Accounts geprüft (29.09.): `gpt-6-astra`, `gpt-4o-mini-transcribe`, `whisper-1`, `gpt-4o-mini-tts` existieren.
- Gelöscht (per Erreichbarkeitsanalyse ab den Einstiegspunkten, ~240 Dateien): alle Agenten außer `agents/master`, alle `agents/*/intent.ts`, `lib/{chatgpt,development,research,review,mail}/intent.ts`, `lib/computer/`, `services/computer/`, Node-Desktop-Service samt Adaptern (Browser, AX, Screen, Shell, Cursor), Worker-Handler `computer/coding/knowledge/planner/development.run`, Seitenleisten, Kontextpanel, Archiv, Upload/Import, Freigabe-Karte, Watch-Banner, Avatar-Lippensync in der Stimme, `three`, `playwright`, Avatar-Assets, alte Doku unter `docs/`, 16 tote npm-Skripte, `.nova/phase0-*`/`abnahme-*`.
- Swift-Helfer (`services/desktop-service/native/main.swift`): nur noch `app.launch`, `automation.mail`, `applescript.run`; AX/CGEvent/Screen-Capture entfernt, neu gebaut und signiert (Binary enthält keine AX/CGEvent-Symbole mehr). Launcher startet keinen Desktop-Service mehr, alter Pfad „My Book 24" entfernt.
- Oberfläche: Orb, Gesprächszeile, Eingabe, PTT, Sprachausgabe. Keine Schnellaktionen mehr.
- Phase 2 (823650d) zurückgenommen, liegt in der Historie.

Nachweise dieser Sitzung:
- `npx tsc --noEmit` grün, `npx eslint .` ohne Befund, `npx next build` grün, `npm run macos:build` → `macos/build/NOVA.app` gebaut und signiert (nicht gestartet).
- `npm run test:kopf`: 8/8 bestanden (geskriptetes Modell, kein Netz, temporärer `NOVA_HOME`).
- `npm run nachweis:phase1`: vier Abnahmesätze gegen die echte API bestanden → `docs/nachweis-phase1-kopf.txt`. Läuft direkt über `runHeadLoop`, **nicht** über App, Datenbank-Verlauf oder Mikrofon.

Nicht geprüft / offen:
- Nichts davon lief in NOVA.app. PTT, Sprachausgabe und der Verlauf über die Datenbank sind nur im Code gelesen, nicht ausgeführt.
- `~/Nova/gedaechtnis/firma.md` enthält den Abnahmesatz schon (aus Cursors Tests). Damit Schritt 4 der Abnahme etwas beweist, vorher leeren.
- Der Helfer wurde neu signiert (gleiche Identity, gleicher Identifier). macOS kann die Automations-Freigabe für Mail trotzdem neu abfragen.
- Mail-Schicht bewusst nicht angefasst (Phase 2): `services/mail/sync.ts` zieht noch Wissens-/Retrieval-/Embedding-Maschinerie nach (`services/knowledge`, `lib/retrieval`, `lib/memory`), darüber hängt `lib/dialog/intent.ts` (Regex) an `lib/memory/policy.ts`. Beim ersten Kontakt in Phase 2 entscheiden. Alte Mail-Dialogpfade (`services/mail/draft.ts`, `answer.ts`, `actions.ts`) sind gelöscht; Cursors Phase-2-Stand davon liegt in 823650d.
- Cursor-CLI-Anbindung (`agents/coding`, `lib/computer/cursor-cli.ts`) gelöscht; für Phase 5 aus der Historie vor diesem Commit holbar.
- DB-Zeilen `AiProviderConfig` für simple/sensitive/fallback bleiben liegen, werden nicht mehr gelesen.

## Dran

**Phase 1 – Abnahme durch Joachim in NOVA.app.** Vorher `~/Nova/gedaechtnis/firma.md` leeren, dann `macos/build/NOVA.app` öffnen und per Taste (rechte Option) sprechen:
1. „Merk dir: unsere Firma ist rankpilot, wir machen Lokal-SEO, wir suchen Sponsoren aus dem Handwerk in Baden-Württemberg."
2. „Was für Sponsoren passen zu uns?"
3. „Und warum die?"
4. App beenden, neu starten, „Was suchen wir nochmal?"

Phase 2 beginnt erst nach dieser Bestätigung, in einem neuen Chat.

## Was Joachim liefert (siehe Auftrag, Anhang)

- Inhalt `firma.md` – diktiert in Phase 1
- Mail-Vorlagen in `~/Nova/vorlagen/` – Phase 2
- Drei Test-Adressen – Phase 3
- PTT-Taste – Standard rechte Option-Taste, bis er etwas anderes sagt

## Offene Punkte, die nicht im Code liegen

- Rechtlicher Rahmen für Werbe-Mails an deutsche Empfänger (US-LLC hilft nicht, Empfängerstandort zählt) – vor der ersten echten Kampagne (Phase 4) klären.
