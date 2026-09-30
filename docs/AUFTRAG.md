# NOVA v2 – Entwicklungsauftrag: Nova als Orchestrator

Repo: `schmittundpartnermedia/nova`. Dieser Auftrag ersetzt alle früheren Aufträge und Phasen-Dokumente im Repo. Was dem hier widerspricht, gilt nicht mehr.

**So wird mit diesem Dokument gearbeitet:** Pro Phase ein neuer Cursor-Chat. Der Chat bekommt dieses ganze Dokument plus den Satz „Arbeite Phase N. Nichts aus späteren Phasen." Eine Phase ist fertig, wenn ihr Abnahmepunkt vom Nutzer in NOVA.app bestätigt wurde – nicht vorher. Erst dann beginnt der nächste Chat mit der nächsten Phase.

---

## 1. Die Vision (das ist das Produkt)

Nova ist eine **Sprach-Oberfläche mit Gedächtnis**, die Aufträge des Nutzers an die Systeme verteilt, die auf seinem Mac schon vorhanden sind, die Ergebnisse kontrolliert und dem Nutzer berichtet.

Der Nutzer spricht mit Nova wie mit einem Assistenten:
- „Such mir 30 passende Sponsoren und schreib sie mit der Vorlage an."
- „Check meine Mails und antworte passend."
- „Gib Cursor den Auftrag, bei rankpilot.de X zu ändern, und sag mir, wenn es fertig ist."

Nova recherchiert nicht selbst, baut nicht selbst, klickt nicht auf dem Bildschirm. Sie beauftragt die Werkzeuge über feste Eingänge (Kommandozeile, API, Datei, Apple Events), wartet, prüft, berichtet. **Fehlt ein Werkzeug, wird es gebaut – der Auftrag wird nicht abgelehnt.**

## 2. Arbeitsregeln (gelten in jeder Phase)

1. **Der Mac des Nutzers ist sein Arbeitsplatz.** Kein Test, Skript oder Build bedient Maus, Tastatur oder Apps, ohne dass der Nutzer es ausdrücklich startet. Automatische Tests laufen ohne Bildschirm (Mock-Provider). Tests, die Apple Mail oder das Mikrofon brauchen, werden nur auf Zuruf des Nutzers gestartet.
2. **An der Wurzel bauen.** Kein Sonderfall, kein Fallback neben dem alten Weg. Was ersetzt wird, wird gelöscht.
3. **Ehrlichkeit.** `executed` nur bei tatsächlicher externer Aktion. Kein Test wird ans Ist-Verhalten angepasst, um grün zu werden. Doku behauptet nichts, was der Code nicht tut.
4. **Fertig heißt: läuft in NOVA.app beim Nutzer.** Jede Phase endet mit `npm run macos:build` und dem Abnahmepunkt der Phase. Nur der Nutzer nimmt ab. Unit-Tests sind Regressionsschutz, kein Nachweis.
5. **Freigaben:** Nova fragt einmal pro Vorhaben („30 Firmen, diese Vorlage, alle 5 Minuten – los?"), nicht pro Schritt. Dauerfreigaben pro System (Mail senden, Cursor beauftragen, Scraper starten) erteilt der Nutzer einmal. Nur Unumkehrbares (Löschen außerhalb des Nova-Ordners, Zahlungen) braucht immer Einzelfreigabe.
6. **Commits:** Nach jedem abgeschlossenen Schritt ein Commit mit ehrlicher Beschreibung (was läuft real, was nicht) und der Ausgabe des Nachweis-Skripts als Datei im Repo (nicht unter `.nova/`, das ist gitignored).

## 3. Behalten / Löschen

**Behalten (echt, funktionierend, teuer erarbeitet):**
- Apple-Mail-Anbindung über den Swift-Helfer: `lib/mail/apple.ts`, `services/mail/apple-events.ts`, `connectors/mail/apple.ts`, `services/desktop-service/native/main.swift` (Mail-Teil), Absender-Allowlist `lib/mail/steerable.ts`
- Hintergrund-Läufer: `services/worker/` (Queue, Lease, Backoff, `runAt`)
- Push-to-Talk und Sprache: `macos/launcher/Sources/AppDelegate.swift` (PTT), `features/voice/`, `providers/voice/`, `lib/knowledge/transcribe.ts`
- Datenbank: `prisma/schema.prisma` inkl. Migration `mail_templates`
- macOS-Launcher: `macos/launcher/` (Ein-Klick-App, Prozess-Überwachung)
- Websuche: `connectors/search/openai.ts`, `lib/research/fetch.ts`
- Zentrale Freigabefunktion: `services/approvals/authorize.ts`
- Vorlagen-Füllung: `lib/mail/templates.ts`

**Löschen (nicht umbauen):**
- Regex-Verteilung: `agents/master/` (der Verteilerteil), alle `intent.ts` in `agents/*`
- Computer-/Klick-Steuerung: `agents/computer/`, `services/computer/`, `services/desktop-service/adapters/input.ts`, `lib/computer/` (Wahrnehmung, Planer, Risikoregeln), CGEvent-/AX-Teile in `main.swift`
- ActiveWork-Konstrukt: `services/work/active.ts` und alles, was darauf aufbaut
- Oberfläche: Seitenleisten für Kontakte, Unternehmen, Aufgaben, Freigaben, Recherche; Avatar-Lab (`/dev/avatar`), Three.js, `features/avatar/`, `services/avatar-animation/`
- Alle Abnahme-/Phasen-Dokumente unter `docs/` und `.nova/`, die „erledigt" behaupten (`ketten-abnahme.md`, `PHASE*.md`, `abnahme-*.md`)
- Mock-Kataloge (`MOCK_SPONSORS` in `agents/research/index.ts`)

Was nicht in einer der beiden Listen steht, wird beim ersten Kontakt entschieden: Nutzt der neue Kopf es? Behalten. Sonst löschen.

## 4. Bauplan: vier Teile

**Kopf** – ein Modell mit Tool-Calling (OpenAI-API, vorhanden). Bekommt bei jeder Anfrage: Satz, Gesprächsverlauf, Dauergedächtnis, Werkzeugliste. Entscheidet Werkzeug und Parameter, sieht das Ergebnis, entscheidet weiter, bis erledigt oder Rückfrage. Keine Regex-Zuordnung mehr, nirgends.

**Werkzeuge** – jedes: Name, Beschreibung, Eingabeschema, fester Aufrufweg, ehrliches Ergebnis. In einer Registry angemeldet; der Kopf sieht nur diese Liste.

**Hintergrund-Läufer** – `services/worker` bleibt der einzige Weg für alles, was wartet oder wiederholt: Kampagnen (`runAt` pro Mail), Postfach-Wache, Cursor-Wache. Läuft ohne offene UI, überlebt Neustarts.

**Gedächtnis** – Gesprächsverlauf der Sitzung geht vollständig mit. Dauergedächtnis als Dateien in `~/Nova/gedaechtnis/` (`firma.md`, `kunden.md`, `projekte.md`), vom Nutzer diktiert und änderbar, gehen bei jeder Anfrage mit.

---

## Phase 1 – Nova versteht und erinnert sich

Ziel: Nova führt ein Gespräch, in dem sie sich an das Vorherige erinnert und den Nutzer und seine Firma kennt. Noch keine Werkzeuge außer Gedächtnis.

Arbeit:
- Gesprächsverlauf der Sitzung vollständig an das Modell übergeben (die letzten N Nachrichten aus `Conversation`/`ConversationMessage`).
- Dauergedächtnis: Ordner `~/Nova/gedaechtnis/` anlegen; `firma.md`, `kunden.md`, `projekte.md` werden bei jeder Anfrage in den Systemprompt geladen. Werkzeuge `gedaechtnis.lesen` und `gedaechtnis.schreiben` (Nutzer diktiert: „Merk dir: wir suchen Sponsoren aus der Region Stuttgart").
- Kopf: Tool-Calling im `AIProvider` (OpenAI); Schleife verstehen → Werkzeug → Ergebnis → weiter. Regex-Verteilung im Master entfernen.
- ActiveWork entfernen; Rückfragen laufen über den Gesprächsverlauf.
- Modellnamen in `providers/ai/models.ts` gegen die real verfügbaren API-Modelle prüfen.
- Klick-Steuerung, Computer-Agent, Avatar, Seitenleisten löschen (Abschnitt 3).

Abnahme durch den Nutzer in NOVA.app (Taste halten, sprechen):
1. „Merk dir: unsere Firma ist rankpilot, wir machen Lokal-SEO, wir suchen Sponsoren aus dem Handwerk in Baden-Württemberg."
2. „Was für Sponsoren passen zu uns?" → Nova antwortet aus dem Gedächtnis.
3. „Und warum die?" → Nova bezieht sich auf ihre vorherige Antwort.
4. App beenden, neu starten, „Was suchen wir nochmal?" → Nova weiß es.

## Phase 2 – Mail

Ziel: Nova liest Mails, legt Entwürfe vor, sendet nach Freigabe.

Arbeit:
- Werkzeuge: `mail.lesen` (neueste / ungelesene / Thread), `mail.entwurf`, `mail.senden`, `mail.antworten`. Alle über `AppleMailProvider`. Absender-Allowlist bleibt.
- Werkzeuge `vorlage.liste`, `vorlage.fuellen`: Vorlagen liegen als Dateien in `~/Nova/vorlagen/*.md` mit Platzhaltern (`{{anrede}}`, `{{firma}}`, `{{ansprechpartner}}` …); Import in `mail_templates`.
- Dauerfreigabe „Mail senden" einmal erteilbar (per Stimme: „Du darfst ab jetzt Mails senden, wenn ich ‚senden' sage" → gespeichert als `ApprovalPolicy`), ausgewertet über `authorizeExternalAction`. Den Fehler beheben, dass bei Dauerfreigabe das Tageslimit verbraucht, aber nicht gesendet wird (`services/mail/draft.ts`).
- Fest im Code stehende Mail-Texte entfernen; Texte kommen aus Vorlage oder vom Kopf.

Abnahme (Nutzer startet den Mail-Test selbst):
1. „Check meine Mails." → Nova fasst die neuesten zusammen.
2. „Antworte auf die von X: wir melden uns nächste Woche." → Nova legt Entwurf vor, liest ihn vor.
3. „Mach es kürzer." → neuer Entwurf.
4. „Senden." → Mail liegt in Apple Mail unter „Gesendet".

## Phase 3 – Kampagne im Hintergrund

Ziel: Nova arbeitet eine Liste ab, eine Mail alle N Minuten, meldet sich fertig, und legt eingehende Antworten vor.

Arbeit:
- Worker-Handler `mail.send` (vorhanden) anschließen an `scheduleMailSendBatch` (`services/mail/schedule.ts`, vorhanden, nirgends aufgerufen). Werkzeug `kampagne.starten` (Vorlage, Kontaktliste, Abstand, Absender) → 30 Work-Items mit `runAt`.
- Eine Freigabe pro Kampagne: Nova fasst zusammen („30 Firmen, Vorlage Sponsoren, alle 5 Minuten, Absender …"), Nutzer sagt ja.
- Werkzeug `kampagne.status` / `kampagne.abbrechen`.
- Meldung nach der letzten Mail (Sprachausgabe + Statuszeile): „Alle 30 sind raus, 2 Adressen ungültig."
- Postfach-Wache als Worker-Job alle 5 Minuten: neue Mail, die auf eine Kampagnen-Mail antwortet → Kopf erzeugt Antwortentwurf → Nutzer wird angesprochen („Antwort von Firma X, mein Vorschlag: … – so senden oder ergänzen?").
- Neustart: laufende Kampagne wird fortgesetzt, Nutzer beim Start informiert.

Abnahme: Testkampagne mit 3 Adressen des Nutzers, Abstand 1 Minute. Alle 3 in „Gesendet". Nutzer antwortet von einer Adresse → Nova legt Entwurf vor → Nutzer ergänzt → „senden" → raus.

## Phase 4 – Scraper

Ziel: „Such mir 30 Sponsoren" läuft über das vorhandene Recherche-Tool des Nutzers.

Arbeit:
- Cursor untersucht das vorhandene Scraper-Tool auf dem Mac (Google-Maps-API, Ansprechpartner-Extraktion): Aufrufweg, Parameter, Ausgabeformat. Ergebnis als kurze Doku im Repo.
- Werkzeug `scraper.starten` (Suchbegriff, Region, Anzahl) und `scraper.ergebnis` → Einleser in `Company`/`Contact` (Name, Website, Ansprechpartner, E-Mail, Quelle).
- Kopf leitet aus dem Gedächtnis ab, was „passend" heißt, und formuliert die Scraper-Anfrage; bei Unklarheit fragt er.
- Websuche (`OpenAISearchProvider`) bleibt als zweites Werkzeug `web.suchen` für Fragen, die kein Scraper-Fall sind.

Abnahme: „Such mir 30 passende Sponsoren und schreib sie mit der Sponsoren-Vorlage an." → Rückfrage → „Ja" → Scraper läuft, Kontakte angelegt, Kampagne läuft, nach Ende Meldung. Alle 30 in „Gesendet".

## Phase 5 – Cursor (ersetzt durch Claude Code, Entscheidung Joachim 30.09.2026 – siehe docs/STAND.md)

Ziel: Nova beauftragt Cursor, wartet, prüft, meldet.

Arbeit:
- Werkzeug `cursor.beauftragen`: Auftrag als Datei `~/Nova/cursor/auftraege/<id>.md` (Projektpfad, Aufgabe, Abnahmekriterium) + Start des Cursor-Agenten per Kommandozeile. Die vorhandene CLI-Anbindung (`agents/coding`) laut Abnahme nicht funktionsfähig – an der Wurzel reparieren oder ersetzen.
- Cursor-Wache als Worker-Job: Status prüfen; bei Fertigstellung Werkzeug `cursor.pruefen` (Diff lesen, Build/Tests des Zielprojekts ausführen, Ergebnis zusammenfassen).
- Meldung an den Nutzer: „Erledigt" / „Build schlägt fehl: …" / „Cursor fragt: …".

Abnahme: „Gib Cursor den Auftrag: auf rankpilot.de im Footer die Telefonnummer auf … ändern. Sag mir, wenn es fertig ist." → Nova meldet Ergebnis, Nutzer prüft die Seite.

## Phase 6 – Oberfläche und Feinschliff

Ziel: Nova ist klein, in der Ecke, immer da.

Arbeit:
- Fenster: Orb + Statuszeile („höre", „arbeite: Kampagne 12/30", „Rückfrage"), immer im Vordergrund, in der Bildschirmecke. Optionales Chatfenster für Aufträge per Text.
- PTT: Berechtigung (Bedienungshilfen/Eingabeüberwachung) beim ersten Start sauber anfordern, Status zeigen; Taste in einem kleinen Einstellungsfenster wählbar; Menübefehl „Voice starten" reparieren oder entfernen.
- Alles Übrige aus der Oberfläche raus (Abschnitt 3).
- Weitere Werkzeuge nach Bedarf des Nutzers: Seedance (Film-KI), Kalender, Dateien.

Abnahme: Nutzer arbeitet einen Vormittag mit Nova in der Ecke; alle Aufträge aus Phase 1–5 per Taste.

---

## Anhang: Was der Nutzer einmal liefert

- Inhalt für `firma.md` (diktiert an Nova in Phase 1).
- Die Mail-Vorlagen als Dateien in `~/Nova/vorlagen/` (Phase 2).
- Drei eigene Test-Adressen für Phase 3.
- Die Push-to-Talk-Taste (Phase 6, vorher Standard: rechte Option-Taste).
