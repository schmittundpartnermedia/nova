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

## Dran

**Phase 1** gilt als offen, bis Joachim den Abnahmepunkt aus `docs/AUFTRAG.md` in NOVA.app bestätigt hat („Merk dir …" / „Was passt zu uns?" / „Und warum die?" / Neustart / „Was suchen wir nochmal?"). Phase 2 wird nicht begonnen, bevor das steht – auch wenn Cursor schon damit angefangen hat.

Nächste Schritte in dieser Reihenfolge:
1. Alles Lokale committen und pushen (auch Branches).
2. Claude prüft Cursors Phase-1-Arbeit gegen den Auftrag: aufbauen oder sauber neu.
3. Phase 1 fertig bauen, `npm run macos:build`, Joachim nimmt ab.
4. Diese Datei aktualisieren, dann Phase 2.

## Was Joachim liefert (siehe Auftrag, Anhang)

- Inhalt `firma.md` – diktiert in Phase 1
- Mail-Vorlagen in `~/Nova/vorlagen/` – Phase 2
- Drei Test-Adressen – Phase 3
- PTT-Taste – Standard rechte Option-Taste, bis er etwas anderes sagt

## Offene Punkte, die nicht im Code liegen

- Rechtlicher Rahmen für Werbe-Mails an deutsche Empfänger (US-LLC hilft nicht, Empfängerstandort zählt) – vor der ersten echten Kampagne (Phase 4) klären.
