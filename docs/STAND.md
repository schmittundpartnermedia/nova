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

**30.09.2026 – Phase 4 gebaut nach Joachims Entscheidung (Claude Code), Abnahme steht aus.**

Entscheidung Joachim: Lead-Scanner sucht **nur Kunden** (lokale Betriebe) und soll E-Mail-Adressen mit ausziehen (tut er bereits aus dem Impressum). **Sponsoren sucht Joachim selbst** und gibt NOVA Firma, Ansprechpartner, Adresse; NOVA schreibt sie personalisiert mit der Vorlage an. Damit weicht Phase 4 bewusst vom Auftrag ab („Such mir 30 Sponsoren“ über den Scraper entfällt).

Was jetzt real im Code steht:
- `kunden_suchen`: Freigabe pro Suche (mit geschätzten Kosten) oder Dauerfreigabe `scanner.start` (`freigabe_scanner_dauer`, Tageslimit zählt Läufe). Lauf als Worker-Job `scanner.lauf` über die Kommandozeile des Lead-Scanners; Ergebnis → `Company`/`Contact` (ohne Doppelte) und Kontaktliste `kunden-<branche>-<ort>-<datum>` mit Anrede („Guten Tag <Name>“ bzw. „Sehr geehrtes <Firma>-Team“), Telefon, Befunden, Aufhänger; Meldung mit Zahlen und größtem Handlungsbedarf. Kein Versand an Kunden – dafür fehlt noch die Kunden-Vorlage.
- `kontakt_hinzufuegen` / `kontaktliste_anzeigen`: Sponsoren auf Zuruf in eine Liste (Standard „sponsoren“) mit Anrede „Sehr geehrter Herr … / Sehr geehrte Frau … / Sehr geehrtes …-Team“; doppelte Adressen werden nicht erneut eingetragen. Versand danach einzeln (Vorlage + Entwurf) oder als Kampagne wie in Phase 3.
- Websuche (`web.suchen` im Auftrag) ist **nicht** gebaut – entfällt mit Joachims Entscheidung, Sponsoren selbst zu suchen.

Nachweise:
- `tsc`, `eslint`, `next build`, `macos:build` grün. `test:kopf` 9/9, `test:mail` 15/15, `test:kampagne` 9/9, `test:kunden` 8/8.
- `npm run nachweis:phase4` → `docs/nachweis-phase4-scanner.txt`: echter Lead-Scanner mit seiner Beispieldatei (ohne Google-API, ohne Website-Abruf) über NOVA gestartet und eingelesen; erzeugte Scanner-CSV danach entfernt.

Nicht geprüft: echte Google-Places-Suche mit Impressum-Auslese (kostet API), Lauf im echten Worker, Sponsoren per Sprache in NOVA.app.

**30.09.2026, nachmittags – Chatfenster, Kunden-Tagesbetrieb, neuer Orb (Claude Code), Abnahme steht aus.**

Joachims Vorgaben: NOVA zeigt alles im Chat wie Claude; Kunden-Mails einmal am Tag als Beispiel vorlegen, dann automatisch; 50 Mails/Tag, alle 5 Minuten, 08–17 Uhr; am Tagesende Bericht/Archiv; Orb „modern 2026“.

Was jetzt real im Code steht:
- Chatfenster (`NovaChat`, `/api/nova/chat`): ganzer Verlauf, Schritte je Antwort aufklappbar, Karten für Entwürfe/Kampagnen mit Freigabe-Knopf. Alte ausblendende Gesprächszeile gelöscht.
- Kunden-Tagesbetrieb (`services/tagesbetrieb/`, Einstellungen `~/Nova/tagesbetrieb.json`, Modell `Lead`, Migration `20260930150000_tagesbetrieb`): Worker-Takt alle 5 Min.; Vorrat über Scanner-Tageslauf (nur mit Dauerfreigabe `scanner.start`); Prüfung jeder Adresse (Form, MX/A, Sperrliste, nie angeschrieben – auch Firma/Domain); morgens eine Beispiel-Mail zur Freigabe, danach eine Mail pro Takt bis 50/Tag oder 17 Uhr; Tagesbericht als Meldung und `~/Nova/berichte/<datum>.md`. Werkzeuge `tagesbetrieb`, `tagesbetrieb_freigeben`, `tagesbericht`, `sperrliste_hinzufuegen`.
- Orb: WebGL-Shader (Plasma, Leuchtrand, Halo, Farbe/Energie je Zustand, Mikrofon-Pegel beim Zuhören).
- Liste `sponsoren` mit den 28 Firmen angelegt. Rechtliches laut Joachim geklärt.

Nachweise: `tsc`, `eslint` grün; `test:kopf` 9/9, `test:mail` 15/15, `test:kampagne` 9/9, `test:kunden` 8/8, `test:tagesbetrieb` 13/13 (ganzer Arbeitstag; fand einen echten Fehler: Betriebe ohne E-Mail wurden doppelt eingelesen – behoben). Chatfenster und Orb im eingebauten Browser gegen die echte DB bzw. die laufende App angesehen (keine Konsolenfehler).

Nicht geprüft / offen:
- Tagesbetrieb nie echt gelaufen: kein echter Scanner-Tageslauf (kostet API: je Lauf bis zu `maxKombisProLauf` = 50 Suchanfragen ≈ 1,75 $), kein Versand über Apple Mail, kein ganzer Tag im echten Worker.
- Kunden-Vorlage `~/Nova/vorlagen/kunden.md` fehlt – ohne sie startet der Tagesbetrieb nicht (meldet es).
- Der laufende Worker in NOVA.app kennt die neuen Aufträge erst nach einem Neustart der App.
- `npm run macos:build` in dieser Runde nicht ausgeführt (Launcher unverändert, App lief).
- Beobachtet: Eine Sponsoren-Mail an stefan.briegel@konzept54.de ging vor der Anrede-Regel mit „Stefan Briegel,“ statt „Sehr geehrter Herr Briegel“ raus.

**30.09.2026, abends – Antwortverhalten und Gestaltung nach Joachims Vorgaben (Claude Code), Abnahme steht aus.**

- NOVA antwortet gesprochen-natürlich und kurz; Entwürfe/Mails liest sie nicht mehr vor (volle Texte als Karte im Chat). Werkzeug `nova_status`: sagt aus dem echten Zustand, was sie kann, was läuft und was fehlt (z. B. Kunden-Vorlage, Scanner-Freigabe). Nachweis gegen echte API: `docs/nachweis-antworten.txt`.
- Sofort-Ansage: Beim Start eines langsamen Werkzeugs sagt NOVA sofort z. B. „Moment, ich schaue in deine Mails.“ und zeigt es im Chat; danach die Fakten. Die Ansage kommt nach der ersten Modellentscheidung (typisch 1–3 s), nicht vor ihr.
- Gestaltung nach Joachims Bildvorlage: runde Kugel schwarz-weiß (Rauch, Leuchtsaum, Glanzlicht, feine Sterne), kreisende Bahnen mit Punkten, gesperrte Statuszeile, Pillen-Eingabe mit Wellen-Symbol, Lautsprecher, großem Mikro und Senden, Wellenform mit Punkt-Ausläufern, Lichthorizont. Außerhalb der Kugel ist die Zeichenfläche exakt durchsichtig (vorher als Kasten sichtbar). Im eingebauten Browser angesehen; in NOVA.app selbst (WebKit) nicht.

**30.09.2026, spät – Phase 5 neu gefasst (Joachims Entscheidung):** Statt Cursor beauftragt NOVA **Claude Code** (CLI `~/.local/bin/claude`, v2.1.286, von Joachim angemeldet; ohne Fenster aufrufbar, geprüft). Cursor-Anbindung entfällt. Projekte: Webseite rankpilot.de = `/Volumes/ELEVUM/Projekte/joachim/rankpilot-website`, App app.rankpilot.de = `/Volumes/ELEVUM/Projekte/joachim/rankPilot-app` (je ein identischer Doppel auf „My Book 24“ und `rankPilot`). Freigabe vorerst: Claude darf ändern, testen und auf GitHub pushen; **live (deploy-rpw / deploy-rp) nur nach Joachims Ja**; später ganz selbstständig. Achtung: Joachims Aliase `deploy-rpw`/`deploy-rp` zeigen noch auf „My Book 24“ – NOVA veröffentlicht über die Skripte im ELEVUM-Ordner. Phase-4-Abnahme steht weiterhin aus.

**30.09.2026, nachts – Phase 5 gebaut (Claude Code statt Cursor), Abnahme steht aus.**

Was jetzt real im Code steht:
- Werkzeuge `claude_beauftragen` (Projekt webseite/app, Aufgabe, Abnahmekriterium), `claude_status`, `claude_live`. Auftrag als Datei `~/Nova/claude/auftraege/<id>.md` + Stand `<id>.json`; Worker `claude.lauf` und `claude.live`.
- Ablauf: NOVA fängt nur an, wenn das Projekt sauber auf `main` steht; eigener Branch `nova/<id>`; Claude Code (`claude -p`, Dateien ändern erlaubt, Befehle nur aus Erlaubtliste, Deploy/ssh/rsync/Push auf main gesperrt) arbeitet, committet, pusht den Branch; NOVA übernimmt Reste, liest Diff, führt die Prüfbefehle selbst aus (Webseite: `npm run check`, `npm run build`; App: `npm run check`), stellt das Projekt zurück auf `main` und meldet sich kurz und vorlesbar mit der Frage „live stellen?“. Nach Joachims Ja (Freigabe genau dieses Auftrags): `pull --ff-only`, Merge, Push von main, Live-Skript im ELEVUM-Ordner; Meldung sagt genau, bis zu welchem Schritt es kam.
- Joachims Aliase `deploy-rpw`/`deploy-rp` in `~/.zshrc` auf ELEVUM umgestellt (Sicherung `~/.zshrc.vor-nova-*`).
- Cursor-Anbindung ist nicht mehr im Code; `nova_status` nennt Claude-Aufträge als Fähigkeit.
- Alle Projekte (Joachims Wunsch): NOVA erkennt jedes Git-Projekt unter `/Volumes/ELEVUM/Projekte/joachim` selbst (heute 11: rankpilot-website, rankpilot-app, adfiltec, dn-masterclass, planexus, elevum, pandb-pflegekonzept, projekt-seedance-studio, diekuehlenretter, dazu elevum-2 und lead-scanner ohne ersten Commit – dort lehnt NOVA mit Erklärung ab). Ausgenommen: NOVA selbst, Doppel `rankPilot`. Ohne Git (kein Auftrag möglich): Projekt OverPark, projekt-x, rankPilot-server-backup, Wichtiges, ZIP-daten-replit-prjekte. Ohne GitHub (elevum, pandb, seedance, diekuehlenretter) wird nur lokal gespeichert. Aufgeräumt 30.09. (auf Joachims Wort): ELEVUM 2 (leer) in den Papierkorb; adfiltec Unterlagen gespeichert (ab87eb2); Seedance `.cursor/` ausgenommen (b09783e); lead-scanner erster Stand ohne .env (4e8d195); dn-masterclass: gesamte offene Arbeit gesichert auf Zweig `entwurf/2026-07-galerie-schriften-anmeldung` (a483007), auf main nur das Aufräumen + fehlende server/auth.ts (01cc57d, tsc und astro build grün, nicht gepusht). Alle 10 Projekte sind jetzt sauber. `test:claude` 8/8 (inkl. Projekterkennung).

Nachweise: `tsc`, `eslint` grün; `test:claude` 7/7 (Wegwerf-Git-Projekt), alle anderen Tests grün (kopf 10, mail 15, kampagne 9, kunden 8, tagesbetrieb 13). `npm run nachweis:phase5` → `docs/nachweis-phase5-claude.txt`: **echtes Claude Code** an einem Wegwerf-Projekt – Footer-Nummer geändert (15 s, ~0,17 $), Branch gepusht, nichts veröffentlicht, Freigabe, übernommen, „live“ (nur Markierung).

Nicht geprüft: echter Auftrag an rankpilot.de, echtes `deploy-rpw`/`deploy-rp`, Lauf im Worker von NOVA.app (braucht Neustart der App). `macos:build` nicht ausgeführt (App lief; Launcher unverändert).

**30.09.2026, 22:40 – Abnahme Phase 5:** Joachim hat Phase 5 in NOVA.app abgenommen („hat geklappt, ist live“). Echter Auftrag 2026-09-30-c0ef15c6: Telefonnummer mit Anruf-Link in den Footer von rankpilot.de (d3c55e5), von NOVA geprüft, nach Joachims Ja übernommen (93ec883) und über das Live-Skript veröffentlicht. Direkt danach hat Joachim per Sprache einen zweiten Auftrag gegeben (2026-09-30-62993ae5: Nummer wieder entfernen, noch nicht veröffentlichen) – lief beim Schreiben dieser Zeilen noch.

**30.09.2026, spät – Phase 6 gebaut (Claude Code), Abnahme steht aus.**

Was jetzt real im Code steht:
- Fenster (`macos/launcher/Sources/Windows.swift`): zwei Größen. **Ecke** (Standard, 280×340, unten rechts, immer im Vordergrund, auf allen Schreibtischen): Orb, Statuszeile, Sprechknopf, Zahnrad, Chat-Knopf. **Chat** (1120×760, normales Fenster): bisherige Ansicht, im Chat-Kopf „In die Ecke“. Wechsel per Knopf oder Menü „Fenster → Chat ein/aus“ (⌘K); Größe, Ort und Modus werden gemerkt. Die Seite und die App reden über `window.__novaApp` / `webkit.messageHandlers.nova` (`features/app/bruecke.ts`).
- Statuszeile: „Höre“, „Rückfrage“, „arbeite: Kampagne x/y“, neu „arbeite: Claude an <projekt>“ / „stelle live: …“ (aus `/api/nova/status`), „Sprechtaste braucht Freigabe“, wenn die Taste nur bei vorderem NOVA-Fenster wirkt.
- Sprechtaste (`Einstellungen.swift`): Einstellungsfenster (Menü „Einstellungen …“ ⌘, oder Zahnrad) mit Tastenwahl (rechte/linke Option, rechte Befehlstaste, Fn, F5) und Zustand von Bedienungshilfen und Mikrofon, Knopf „Freigabe öffnen“ führt zur Systemeinstellung. Beim allerersten Start fragt NOVA einmal nach der Freigabe Bedienungshilfen; kommt oder geht die Freigabe, legt NOVA den Tastenbeobachter neu an. Der alte Umweg über `NOVA_PTT_KEY` ist weg.
- Entfernt: Menüpunkt „Voice Session starten“ (klickte einen Knopf, den es nicht mehr gab), Datei-Auswahl-Dialog (Upload war schon gelöscht), Sprach-Diagnose beim Laden, doppelter PTT-Aufruf (Ereignis **und** Funktion – die Taste löste zweimal aus).

Nachweise: `tsc`, `eslint`, `next build`, `macos:build` grün; alle Tests grün (kopf 10, mail 15, kampagne 9, kunden 8, tagesbetrieb 13, claude 8). Ecke und Chat im eingebauten Browser angesehen, keine Konsolenfehler → `docs/nachweis-phase6.txt`.

Nicht geprüft: NOVA.app selbst (Eckfenster, immer vorne, Wechsel, Einstellungsfenster, Freigabe-Dialog, Tastenwahl) – gebaut, nicht gestartet.

**30.09.2026, 23:00 – Phase 6 in NOVA.app bestätigt:** Joachim: „passt alles“ – Eckfenster, immer vorne, Sprechtaste aus anderen Programmen, Wechsel Chat/Ecke, Einstellungen. Next-Entwicklersymbol („N“) ausgeblendet (facdf69), bestätigt. Offen aus dem Auftrag: der „Vormittag mit NOVA in der Ecke“ im echten Alltag.

**30.09.2026, 23:15 – Kunden-Vorlage (Claude Code):** Joachim hat die Kunden-Vorlage geliefert → `~/Nova/vorlagen/kunden.md` (Betreff „Kurze Frage zu Ihrer Google-Sichtbarkeit“, Platzhalter `anrede`, `firma`, `feststellung`; Link https://rankpilot.de/check, erreichbar geprüft; Grußformel kommt aus der Apple-Mail-Signatur wie bei den Sponsoren). Neu `lib/leads/feststellung.ts`: macht aus den festen Befund-Texten des Scanners höchstens zwei lesbare Sätze (wichtigste zuerst). Ohne verwertbaren Befund bleibt `feststellung` leer → der Tagesbetrieb verwirft den Betrieb („fehlende Werte für die Vorlage“), es geht keine Mail mit erfundener Feststellung raus. Spalte `feststellung` auch in den Kundenlisten. `test:kunden` 9/9 (neu: Feststellungen, leerer Befund → fehlender Platzhalter), `test:tagesbetrieb` 13/13.

**30.09.2026, 23:40 – Kunden-Mail umgestellt (Joachims Vorgabe):** Jede Firma mit E-Mail bekommt die Mail; Kern ist KI-Suche (kurz erklärt), der Scanner-Befund kommt nur dazu, wenn es einen gibt. Neu: optionaler Platzhalter `{{?name}}` in `lib/mail/templates.ts` – ohne Wert fällt die ganze Zeile weg; Pflicht-Platzhalter bleiben Pflicht. Vorlage `~/Nova/vorlagen/kunden.md` neu (Betreff „Wird {{firma}} in KI-Suchen empfohlen?“). Damit gilt nicht mehr, dass Betriebe ohne Befund verworfen werden. Der echte Scan „Schreinereien Pforzheim“ ergab 10 Betriebe, 9 mit E-Mail, alle 9 mit Befund. `test:kunden` 9/9, `test:mail` 15/15, `test:kampagne` 9/9, `test:tagesbetrieb` 13/13.
Auf Joachims ausdrückliches Wort gelöscht: fünf archivierte Testgespräche aus Cursors ChatGPT-Import-Tests (Alpha, Beta, Gamma, Smalltalk, Omega; 11 Gespräche inkl. Doppel, 38 Nachrichten); DB-Sicherung vorher im Scratchpad.

**30.09.2026, 23:55 – Keine Gedankenstriche in Mails (Joachims Vorgabe):** `lib/mail/stil.ts`. `erstelleEntwurf` (einziger Weg für alle Entwürfe: Kopf, Kampagne, Tagesbetrieb) lehnt Betreff/Text mit – oder — ab; `fuelleVorlage` lehnt Vorlagen mit Gedankenstrich ab und macht aus Gedankenstrichen in eingesetzten Werten (z. B. Firmennamen) Bindestriche. Kopf-Anweisung ergänzt. Kunden-Vorlage bereinigt. `test:mail` 16/16 (neu), übrige Tests grün.

**01.10.2026, 00:30 – Mail-Gestaltung nach Joachims Test-Mail (Claude Code):** Joachims Test über NOVA.app kam an (Gmail), aber: Absender hieß nur „joachim“, Absätze zu weit, nichts fett.
- Anzeigename je Absender: `~/Nova/absendernamen.txt` (`joachim@rankpilot.de = rankPilot Joachim Schmitt`), gesendet als „Name <adresse>“ (`lib/mail/absendernamen.ts`).
- Fettdruck: `**so**` in Vorlage oder Kopf-Text; beim Senden Sternchen raus, Bereiche per AppleScript `set font of characters i thru j … to "Helvetica-Bold"` (`lib/mail/fett.ts`, `lib/mail/apple.ts`). HTML kann Apple Mail per Skript nicht (`html content` laut Apple „does nothing“). Chat-Karte zeigt Fettdruck.
- Optionale Abschnitte jetzt `{{#name}} … {{/name}}` (auch mitten im Absatz), ersetzt `{{?name}}`. Vorlage `kunden.md` mit weniger Absätzen, Link direkt unter dem Satz.
- Feststellung: „Ihre Website … und sie …“ statt doppelt „Ihre Website“.
Tests: mail 17/17, kunden 9/9, kopf 10, kampagne 9, tagesbetrieb 13, claude 8.
**Nicht geprüft:** ob Apple Mail den Fettdruck und den Anzeigenamen wirklich so verschickt – braucht eine echte Test-Mail. Der große Abstand vor der Signatur kommt nicht aus NOVAs Text (endet ohne Leerzeilen); vermutlich aus der Signatur in Apple Mail selbst, nicht geprüft.

**01.10.2026, 00:45 – Kunden-Mail gekürzt (Joachims Entscheidung „1 nehmen“):** Vorlage rund 100 Wörter: Problem KI-Suche zuerst, dann ein Befund, dann Check-Link, Vorstellung mit Buch am Ende. Nur noch **ein** Befund, Vorrang nach Verständlichkeit (Bewertungen, keine Website, Bewertungsschnitt, Smartphone, HTTPS, …; technische Punkte zuletzt). Ohne Befund fällt der ganze mittlere Absatz weg. `test:kunden` 9/9, `test:tagesbetrieb` 13/13.

**01.10.2026, 01:00 – Fehler aus Joachims Test-Entwurf behoben:** Der Entwurf enthielt noch zwei Befunde („Ihre Website … und Ihre Website …“), weil die Pforzheim-Liste die Feststellung mit der alten Regel gespeichert hatte und der Kopf sie übernahm. Jetzt wird `feststellung` nie gespeichert, sondern beim Lesen einer Liste (`leseKontaktliste`) frisch aus `befunde` gebildet; eine alte Spalte wird überschrieben. Test dafür ergänzt; kunden 9/9, kampagne 9/9, tagesbetrieb 13/13.

**01.10.2026, 01:15 – Test-Mail bestätigt:** Joachim: Fettdruck, Absender, Abstände passen. Der große Abstand vor der Signatur kam aus Leerzeilen oben in seiner Apple-Mail-Signatur; Joachim hat sie entfernt („passt“).

**01.10.2026 – Ausbau nach Joachims Auftrag „1 bis 5 der Reihe nach“ (Claude Code).**

**1. Antworten zuverlässig erkennen – gebaut.** Die Postfach-Wache liest nicht mehr die 15 neuesten Mails, sondern alles, was seit ihrem letzten Lauf (minus 10 Min. Überlappung, Stand in `~/Nova/zustand/postfach-wache.json`) in Posteingang **und Werbung/Junk** eingegangen ist, bis 300 je Lauf (`eingangSeitScript`, Postfach-Methode `eingang`). Antwort = Mail verweist per In-Reply-To/References auf die Message-ID einer unserer Kampagnen-Mails (erkennt auch Kollegen mit anderer Adresse) oder kommt vom angeschriebenen Empfänger; eigene Adressen werden übergangen. Die Wache bleibt geplant, auch wenn Apple Mail nicht antwortet (vorher starb sie bei einem Fehler). Tests: kampagne 11/11 (neu: Kollegen-Antwort über Verlauf, fremde und eigene Mails nicht; Wache bleibt geplant), Gegenprobe ohne Verlaufsprüfung schlägt fehl. **Nicht geprüft:** das neue AppleScript gegen das echte Apple Mail.

**2. Absagen, Rückläufer, Abwesenheit – gebaut.** Sperrliste jetzt zentral (`lib/mail/sperrliste.ts`) und überall wirksam: Kampagnen-Planung sortiert gesperrte Adressen aus (vorher nur der Tagesbetrieb), `sendeEntwurf` sendet keine Kampagnen-/Tagesbetriebs-Mail an eine inzwischen gesperrte Adresse (Status `cancelled`). Postfach-Wache: **Rückläufer** (Absender MAILER-DAEMON/postmaster) → volle Meldung lesen, betroffene Kampagnen-Adresse aus dem Text → `deliveryStatus BOUNCED`, Sperrliste, eine Sammelmeldung. **Abwesenheitsnotizen** (RFC-3834-Kopfzeilen Auto-Submitted, X-Autoreply, X-Autorespond, Precedence) → festgehalten als `autoreply`, kein Kopf, keine Meldung. **Absage / keine Mails erwünscht** → der Kopf entscheidet beim Lesen, setzt Adresse(n) mit `sperrliste_hinzufuegen` auf die Sperrliste, legt keinen Entwurf an, meldet in einem Satz. Kampagnenstand und Abschlussmeldung nennen Gesperrte und Unzustellbare; Tagesbericht trennt Antworten, Abwesenheitsnotizen, Rückläufer. Tests: kampagne 14/14, mail 18/18, alle anderen grün. **Nicht geprüft:** echte Rückläufer-/Abwesenheits-Mails in Apple Mail; ob Apple Mail die Kopfzeilen so liefert.

**3. Nachfass-Mail – gebaut.** Migration `20261001090000_nachfass` (Campaign `nachfass_tage`, `nachfass_vorlage`; Communication `vorlagen_werte`, `nachfass_zu`) – eingespielt, während der Worker lief, darum per SQLite mit Wartezeit und von Hand verbucht (Prüfsumme wie Prisma; `migrate status` sauber; DB-Sicherung vorher im Scratchpad). Gibt es die Vorlage `<vorlage>-nachfass`, plant `kampagne_planen` standardmäßig eine Nachfass-Mail nach 6 Tagen (Parameter `nachfass_tage`: -1 Standard, 0 aus, 2–30); sie steht in Plan und Freigabetext, die Kampagnen-Freigabe deckt sie. Tagesbetrieb ebenso (`nachfassTage` 6, `nachfassMaxProTag` 30 in `~/Nova/tagesbetrieb.json`; ohne Vorlage einfach ohne Nachfass). Worker `nachfass.tick` alle 30 Min.: nur werktags im Zeitfenster, je Firma höchstens einmal, nicht bei Antwort (auch Kollege), Sperrliste, Rückläufer, abgebrochener Kampagne, nicht später als 5 Tage nach Fälligkeit; Versand über `mail.send` im Abstand der Kampagne; unmittelbar vor dem Versand wird erneut auf Antwort geprüft. Meldung „Ich fasse bei N Betrieben nach …“. Stand/Statuszeile zählen Nachfass getrennt, Tagesbericht markiert sie. Vorlage `~/Nova/vorlagen/kunden-nachfass.md` als **Vorschlag** angelegt – Joachim muss sie lesen; ohne die Datei gibt es keine Nachfass-Mail. Tests: `test:nachfass` 6/6 (neu, Gegenprobe ohne Antwortprüfung schlägt fehl); der Tagesbetriebs-Test fand einen echten Fehler (fehlende Nachfass-Vorlage hätte den Tagesbetrieb gestoppt) – behoben. **Nicht geprüft:** Nachfass im echten Worker über mehrere Tage.

**4. Sehen, was wirkt – gebaut, braucht noch zwei Freigaben von Joachim.** Befund (nur gelesen): Die Webseite speichert bei jedem Check schon `utm_*` in der App-Tabelle `ads_checks.payload.utm`; `ref` o. Ä. wird verworfen; eine Abfrage mehrerer Checks von außen gab es nicht.
- NOVA: Jede Kampagnen-/Tagesbetriebs-/Nachfass-Mail bekommt einen eigenen Kurzlink `https://rankpilot.de/check?c=<8 Zeichen>` (gespeichert in `communications.external_url`; einzelne Mails nicht). `services/wirkung.ts` + Werkzeug `wirkung_anzeigen`: je Kampagne gesendet, Antworten, gestartete Checks, angelegte Konten. Tagesbericht hat einen Abschnitt „Gestartete rankPilot Checks“. Ohne Schlüssel sagt NOVA ehrlich „Checks werden noch nicht gezählt“ (`nova_status` nennt es als fehlend). Test `test:wirkung` 4/4 (neu), Kopf-Test um das Werkzeug ergänzt, alle anderen grün.
- Webseite `rankpilot-website`, Zweig **`nova/check-kurzlink`** (gepusht, **nicht live**): `TrackingInit.astro` macht aus `?c=<code>` `utm_source=nova, utm_medium=email, utm_content=<code>`. astro check 0 Fehler, build grün.
- App `rankPilot-app`, Zweig **`nova/check-herkunft`** (gepusht, **nicht live**): `GET /api/internal/nova/checks?seit=` mit dem Ingest-Schlüssel, ohne Kontaktdaten. tsc grün, vitest 1817/1817.
- Damit gezählt wird, fehlt: (1) beide Zweige übernehmen und live stellen (Joachims Ja), (2) `RANKPILOT_CHECKS_TOKEN=<Wert von ADS_CHECK_INGEST_SECRET>` in NOVAs `.env` – trägt Joachim selbst ein. Bis dahin funktioniert der Kurzlink normal (der Check ignoriert `c`), gezählt wird nur noch nicht.

**5. Tagesüberblick – gebaut.** Werkzeug `tagesueberblick` (`services/ueberblick.ts`): was wartet (Kampagnen-Antworten ohne gesendete Rückmeldung, ob ein Entwurf bereitliegt; offene Freigaben; nicht gesendete Einzelentwürfe; Claude-Aufträge fertig/mit Problem), was läuft (Kampagnen, geplante Nachfass-Mails, Tagesbetrieb), Zahlen seit gestern (gesendet, Antworten, Checks, Konten), ungelesene Mails (Apple Mail nicht lesbar → ehrlicher Hinweis). Kopf-Regel: „Was liegt heute an?“/„Guten Morgen“ → höchstens sechs gesprochene Sätze, Wartendes zuerst. Sofort-Ansagen für Überblick und Wirkung. Tests: `test:wirkung` 5/5 (inkl. Überblick). `npm run nachweis:ueberblick` → `docs/nachweis-ueberblick.txt`: echte API bestanden (Überblick nennt Ehrismann-Antwort, fertigen Claude-Auftrag, Steuerbüro-Mail; Wirkung sagt ehrlich, dass Checks noch nicht gezählt werden).

Abschluss dieser Runde: `tsc`, `eslint`, `next build`, `npm run macos:build` grün; alle Tests grün (kopf 10, mail 18, kampagne 14, kunden 9, tagesbetrieb 13, claude 8, nachfass 6, wirkung 5). NOVA.app neu gebaut, nicht gestartet. **Nichts davon lief gegen das echte Apple Mail oder im echten Worker.**

## Dran

**Joachim, wenn er zurück ist:**
1. NOVA.app starten (Worker kennt die neuen Aufträge `nachfass.tick` erst dann).
2. ~~Nachfass-Vorlage lesen~~ – Joachim hat `~/Nova/vorlagen/kunden-nachfass.md` am 01.10. bestätigt („passt, machen wir“).
3. Erster echter Versand wie geplant: „Schreib die Schreinereien aus Pforzheim mit der Kunden-Vorlage an, alle 5 Minuten.“ – die Zusammenfassung nennt jetzt auch die Nachfass-Mail nach 6 Tagen.
4. Zählung der Checks freischalten (optional, später): Zweige `nova/check-kurzlink` (Webseite) und `nova/check-herkunft` (App) übernehmen und live stellen, danach `RANKPILOT_CHECKS_TOKEN` in NOVAs `.env` selbst eintragen.
5. „Guten Morgen, was liegt heute an?“ ausprobieren.
Danach: Phase 7 (Browser/Plattformen). Später: Kopf-Vergleich OpenAI/Claude, Kostenübersicht, Kalender (Punkt 6 der Liste, nicht beauftragt).

## Was Joachim liefert (siehe Auftrag, Anhang)

- Inhalt `firma.md` – diktiert in Phase 1
- Mail-Vorlagen in `~/Nova/vorlagen/` – Sponsoren und Kunden geliefert (30.09.)
- Drei Test-Adressen – geliefert (30.09.), liegen lokal in `~/Nova/kampagnen/testadressen.txt`
- PTT-Taste – Standard rechte Option-Taste, bis er etwas anderes sagt

## Offene Punkte, die nicht im Code liegen

- Rechtlicher Rahmen für Werbe-Mails: laut Joachim am 30.09.2026 geklärt (Entscheidung und Verantwortung bei Joachim).
