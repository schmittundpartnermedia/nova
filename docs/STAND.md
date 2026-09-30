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

**29.09.2026, abends – Neustart der Daten, Phase 2 gebaut (Claude Code).**

Auf Joachims Anweisung: `~/Nova/gedaechtnis/firma.md` geleert, das aktive Gespräch archiviert (nicht gelöscht; DB-Sicherung vorher im Scratchpad). Phase 2 begonnen, **obwohl die Abnahme von Phase 1 noch aussteht** – ausdrücklich von Joachim so angewiesen.

Was jetzt real im Code steht:
- Werkzeuge: `mail_lesen` (neueste / ungelesen / eine Nachricht), `mail_entwurf`, `mail_antworten`, `mail_senden`, `freigabe_mail_dauer`, `vorlage_liste`, `vorlage_fuellen`.
- Apple Mail wird live gelesen (gemeinsamer Posteingang, ein AppleScript-Aufruf, max. 15 Mails). Der alte Sync von Mails in eine Wissensdatenbank samt Embeddings/Retrieval, IMAP/SMTP/OAuth und die letzte Regex-Datei (`lib/dialog/intent.ts`) sind gelöscht, ebenso `imapflow`, `mailparser`, `nodemailer`.
- Entwürfe liegen in `communications` (neu: `from_address`, `to_address`, `reply_ref`; Migration `20260929180000_mail_phase2`). „Mach es kürzer“ legt einen neuen Entwurf an und setzt den alten auf `superseded`.
- Senden (`services/mail/entwuerfe.ts`, ein Weg für Kopf und Worker): ohne Dauerfreigabe legt NOVA eine Freigabe an und fragt einmal; erst mit der Freigabe **dieses** Entwurfs geht die Mail raus. Gesendet = im Ordner „Gesendet“ des Absenderkontos gefunden.
- Fehler aus dem Auftrag behoben: `authorizeExternalAction` verbraucht nichts mehr; das Tageslimit einer Dauerfreigabe zählt nur tatsächlich gesendete Mails. Dauerfreigabe gibt es nur noch für `mail.send`; die alte Klick-Freigabe ist weg. Alle alten Dauerfreigaben aus Cursors Tests sind widerrufen (Migration, nicht gelöscht).
- Fest verdrahtete Mailtexte entfernt (`DEFAULT_OUTREACH_TEMPLATE`, Ersatzwerte wie „Ihnen“/„unserem Vorhaben“). Vorlagen kommen aus `~/Nova/vorlagen/*.md`; fehlende Platzhalter werden gemeldet.
- Gesprächsverlauf trägt jetzt das Werkzeugprotokoll jeder Antwort (Entwurfs-ID, Freigabe-ID, Mail-Verweise). Ohne das wusste das Modell im nächsten Satz nicht, welcher Entwurf gemeint ist – gefunden durch den Nachweis.
- Nebenbei: die Migration `mail_templates` war in der DB von Hand eingespielt, aber nie verbucht; als angewendet markiert, Schema und DB stimmen jetzt überein (`prisma migrate diff` leer).

Nachweise:
- `npx tsc --noEmit`, `npx eslint .`, `npx next build`, `npm run macos:build` grün.
- `npm run test:kopf` 9/9, `npm run test:mail` 14/14 (Test-Postfach, Wegwerf-DB; echte DB unberührt). Zwei absichtlich eingebaute Fehler (Limit zählt Fehlversuche; Versand ohne Freigabe) wurden von den Tests erkannt.
- `npm run nachweis:phase2` → `docs/nachweis-phase2-kopf.txt`: alle Abnahmesätze gegen die echte API bestanden, dazu Dauerfreigabe per Stimme. **Mit Test-Postfach, nicht mit Apple Mail.**

Nicht geprüft / offen:
- Nichts lief gegen Apple Mail oder in NOVA.app: Lesen, Antworten, Senden und die Bestätigung im Ordner „Gesendet“ sind nur im Code und mit Test-Postfach geprüft.
- `~/Nova/vorlagen/` ist leer – Vorlagen liefert Joachim.
- Antwortet NOVA auf eine Mail, die an ein nicht steuerbares Konto ging (z. B. iCloud), fragt sie nach dem Absender. Ob Apple Mail beim Antworten den gesetzten Absender übernimmt, ist nicht live geprüft.
- `mail_accounts`-Zeilen in der DB werden nicht mehr gelesen (Konten kommen live aus Apple Mail).
- Phase 1 ist weiterhin nicht abgenommen.

**30.09.2026 – Abnahme:** Joachim hat Phase 1 und Phase 2 in NOVA.app abgenommen („Phase 1 … funktioniert", „Phase 2 funktioniert vollständig"). Damit sind beide Phasen fertig.

**30.09.2026 – Phase 3 gebaut (Claude Code), Abnahme durch Joachim steht aus.**

Was jetzt real im Code steht:
- Werkzeuge `kampagne_planen` (legt Entwürfe + eine Freigabe an, sendet nichts), `kampagne_starten` (nur mit der Freigabe dieser Kampagne), `kampagne_status`, `kampagne_abbrechen`.
- Neues Modell `Campaign` (Migration `20260930120000_kampagnen`), Entwürfe tragen `campaign_id` und `recipient_name`. Kontaktlisten: `~/Nova/kampagnen/*.csv` (`lib/mail/kontaktlisten.ts`); ungültige Adressen, doppelte Adressen und fehlende Platzhalterwerte werden mit Grund aussortiert.
- `scheduleMailSendBatch` ist angeschlossen: eine Mail pro Work-Item mit `runAt` im Abstand. Kampagnen-Mails gehen nur, solange die Kampagne läuft und ihre Freigabe erteilt ist. Kein automatischer zweiter Versuch; ein unterbrochener Versand (`SENDING`) wird nicht blind wiederholt.
- Nach der letzten Mail: Meldung ins Gespräch („Alle N Mails sind raus …“, mit Fehlschlägen und ungültigen Adressen). Oberfläche fragt alle 15 s `/api/nova/status`, zeigt und spricht neue Meldungen einmal, Statuszeile „arbeite: Kampagne x/y“.
- Postfach-Wache (`postfach.wache`, alle 5 Min., solange Kampagnen-Mails der letzten 14 Tage existieren): neue Mail von einem Kampagnen-Empfänger → Kopf legt Antwortentwurf an → Meldung „Antwort von …, mein Vorschlag … – so senden oder ergänzen?“. Die Wache sendet nie.
- Neustart: Der Worker meldet beim Start laufende Kampagnen (höchstens einmal in 10 Minuten); geplante Work-Items liegen in der DB und laufen weiter.
- Gedächtnis `firma.md` ergänzt: Kampagnen immer von joachim@rankpilot.de, Listen in `~/Nova/kampagnen/`.
- Listen von Joachim: `sponsoren-2026-09.csv` (28 Firmen aus seinen drei Listen; Pennylane und Edenred ohne Mail-Adresse ausgelassen; Auffälligkeiten in Spalte `hinweis`) und `test.csv` (seine drei Test-Adressen) – beide nur lokal.

Nachweise:
- `tsc`, `eslint`, `next build`, `macos:build` grün. `test:kopf` 9/9, `test:mail` 15/15, `test:kampagne` 9/9. Der Kampagnen-Test hat einen echten Fehler gefunden (Abbruch ließ ein geplantes Work-Item stehen) – im Code behoben. Gegenprobe: Freigabe-Prüfung für Kampagnen-Mails entfernt → Test schlägt fehl.
- `npm run nachweis:phase3` → `docs/nachweis-phase3-kopf.txt`: gegen die echte API bestanden – planen, Zusammenfassung, „Ja“, 3 personalisierte Mails, Abschlussmeldung, Stand, Antwort erkannt, Vorschlag, „Ergänze …“, „Senden“, „Ja“. **Mit Test-Postfach; Worker-Handler direkt aufgerufen.**

Nicht geprüft / offen:
- Nichts davon lief gegen Apple Mail oder im echten Hintergrund-Läufer mit Wartezeiten; Neustart der App mit laufender Kampagne nicht ausprobiert.
- Eine Antwort wird nur erkannt, wenn sie unter den 15 neuesten Mails im gemeinsamen Posteingang ist und vom angeschriebenen Absender kommt.
- Rechtlicher Rahmen für Werbe-Mails an die echten Sponsoren-Firmen ist ungeklärt (siehe unten) – vor dem Versand der Liste `sponsoren-2026-09` klären.

**30.09.2026, vormittags – Empfangsproblem, nicht im Code:** Joachims Test-Antwort an joachim@rankpilot.de kam nie an. Ursache: rankpilot.de hatte neben den IONOS-MX einen dritten MX gleicher Priorität (`inbound-smtp.eu-west-1.amazonaws.com`), etwa jede dritte Mail ging an Amazon SES statt ins Postfach. Joachim hat den Eintrag gelöscht; alle IONOS-Nameserver liefern nur noch mx00/mx01.ionos.de. Getrennt davon landen seit 29.09. neue Mails bei info@joachimschmitt.com und info@elevum.io im Papierkorb – kein NOVA-Code löscht oder verschiebt Mails (geprüft, auch in der Historie); Ursache vermutlich Server-Filter oder ein anderes Gerät/Programm, Joachim prüft.

**30.09.2026, 10:22 – Abnahme Phase 3:** Joachim hat Phase 3 in NOVA.app abgenommen: Testkampagne an 3 Adressen raus, Antwort erkannt, Vorschlag ergänzt, „senden“ → Antwort mit Signatur in Gmail angekommen.
Bekannte Grenze: Die Postfach-Wache ordnet eine Antwort über den Absender zu, nicht über den Mail-Verlauf. Bei der Abnahme hatte Joachim auf die frühere Einzel-Testmail („[NOVA-Test] … Zurich“) geantwortet; erkannt wurde sie, weil der Absender auch Kampagnen-Empfänger war.

## Dran

**Phase 4 – Scraper** (siehe `docs/AUFTRAG.md`). Startet auf Joachims Signal. Vorher klären: rechtlicher Rahmen für Werbe-Mails an die echten Sponsoren-Firmen.

## Was Joachim liefert (siehe Auftrag, Anhang)

- Inhalt `firma.md` – diktiert in Phase 1
- Mail-Vorlagen in `~/Nova/vorlagen/` – Sponsoren geliefert (30.09.), Kunden folgt
- Drei Test-Adressen – geliefert (30.09.), liegen lokal in `~/Nova/kampagnen/testadressen.txt`
- PTT-Taste – Standard rechte Option-Taste, bis er etwas anderes sagt

## Offene Punkte, die nicht im Code liegen

- Rechtlicher Rahmen für Werbe-Mails an deutsche Empfänger (US-LLC hilft nicht, Empfängerstandort zählt) – vor der ersten echten Kampagne (Phase 4) klären.
