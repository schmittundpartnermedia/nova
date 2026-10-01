# Lead-Scanner – was er kann (Untersuchung 30.09.2026, nur gelesen, nichts ausgeführt)

Ort: `/Volumes/ELEVUM/Projekte/joachim/lead-scanner` (Node/TypeScript, eigenes lokales Repo ohne GitHub).

## Gebietssuche (seit 01.10.2026, so nutzt NOVA den Scanner)

- `npm run gebiet -- --branche "<Branche>" --mitte "<Ort>" --radius <km> [--max-anfragen <n>]` (Datei `src/gebiet.ts`).
- Findet **alle** Betriebe der Branche im Umkreis: Der Kreis wird in 8-km-Kacheln zerlegt, jede Kachel wird bei Google Places (Text Search) mit fester Gebietsgrenze (`locationRestriction`) abgefragt. Liefert eine Kachel die Google-Obergrenze von 60 Treffern, wird sie geviertelt (bis 1 km). Zusammenführung über `placeId`; außerhalb des Radius und dauerhaft Geschlossene fallen weg.
- Kosten: ~0,035 $ je Anfrage; 40 km ≈ 96 Startkacheln ≈ 4–5 $ je Branche, Obergrenze `--max-anfragen` (NOVA: 4 × Kachelzahl, bei 40 km 384 Anfragen ≈ 13,44 $). Wird sie erreicht, meldet der Scanner „unvollständig“.
- Danach Website-Prüfung je Betrieb (6 parallel): E-Mail, Ansprechpartner, Befunde, Score. Ausgabe `output/gebiet_<branche>_<ort>_<km>km_<datum>.csv` mit `placeId, …, ort, entfernungKm, …`.
- Ohne Google (Nachweise): `--fixture <places.json> --lage <lat,lng>`. Test: `npm run test:gebiet` (nachgebautes Google, prüft Vollständigkeit).
- NOVA: Werkzeug `kunden_suchen` (branche, ort, radius_km) und der Tagesbetrieb (Suchgebiet + Branchen-Reihenfolge in `~/Nova/tagesbetrieb.json`, erledigte Branchen in `~/Nova/zustand/suchplan.json`). Alle Treffer kommen in den Vorrat (`leads`), werden geprüft und vom Tagesbetrieb mit Tageslimit angeschrieben.

## Ältere Aufrufwege (nicht mehr von NOVA genutzt)

- Einzel-Scan: `npm run scan -- --branche "<Branche>" --ort "<Ort>" --limit <n>` (im Projektordner)
  - Optional: `--fixture <json>` (Places-Antwort aus Datei statt API), `--skip-audit` (keine Website-Analyse)
  - Ausgabe: `output/leads_<branche>_<ort>_<YYYY-MM-DD>.csv` + Konsolen-Tabelle
- Täglicher Lauf: `npm run daily` arbeitet `config/targets.json` ab (20 Orte × 20 Branchen, 20 neue Leads pro Lauf), merkt sich den Fortschritt in `state.json`, hängt neue Leads an `data/leads.csv` an. Der launchd-Job dafür ist laut README nicht geladen.
- Arbeitsliste für Telefonakquise: `npm run heute`, `npm run mark`, `npm run pipeline` (Status offen/angerufen/termin/…).

## Datenquelle und Ausgabe

- Google Places API (New), Text Search; Key in `.env` (`GOOGLE_PLACES_API_KEY`, gesetzt). Kosten laut README ~0,035 $ pro Anfrage (max. 20 Treffer).
- Website-Analyse je Treffer: Startseite und Impressum; daraus `email`, `ansprechpartner` (Fallback Inhaber/Geschäftsführer), SEO-Befunde und ein Score.
- CSV-Spalten (Einzel-Scan): `name, inhaberName, ansprechpartner, telefon, email, adresse, website, finalUrl, rating, reviewCount, score, befunde, aufhaenger`.

## Passung zum Auftrag (Phase 4)

- **Zielgruppe:** Das Tool findet lokale Betriebe einer Branche in einem Ort (Zahnärzte, Handwerker, Friseure … in Baden-Württemberg) und bewertet deren Website-Mängel. Das sind potenzielle **Kunden** von rankPilot, nicht Sponsoren/Alliance-Partner wie in der Sponsoren-Liste (überregionale Anbieter wie Hiscox, Mollie, sipgate).
- **Ausdrückliche Grenze im Tool:** README und `package.json`: Die Listen dienen „ausschließlich“ der Telefon-, Flyer- und Postakquise, „kein E-Mail-Versand“. Die E-Mail-Adressen aus dem Impressum sind dort als reine Datenerfassung für manuelle Akquise gedacht.
- Folge: „Such mir 30 passende Sponsoren und schreib sie an“ lässt sich mit diesem Tool so nicht umsetzen, ohne entweder die Zielgruppe (Sponsoren) oder die selbst gesetzte Grenze (keine E-Mails) zu ändern. Entscheidung liegt bei Joachim.
