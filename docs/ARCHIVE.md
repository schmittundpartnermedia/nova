# Archiv

Das Archiv ist neben dem Orb die einzige wichtige Zusatzoberfläche. Standardmäßig geschlossen.

## Inhalt

Chronologische Aktivitäten von NOVA.

Status:

- `suggested` – Vorschlag
- `prepared` – vorbereitet
- `executed` – wirklich extern ausgeführt
- `failed` – versucht, aber nicht ausgeführt

V1 markiert Recherche und Anschreiben als `prepared` / `suggested`. Versandversuche ohne Connector als `failed`. Niemals als `executed`, wenn nichts Externes passiert ist.

Recherche speichert im Archiv die Nutzerfrage über den Job, die Queries, Quellen-IDs und das Ergebnis. Komplette Webseiten werden nicht archiviert.

## Deep Links

`external_reference` und `external_url` führen zur Original-Mail, zum Termin, zur Datei oder zur Recherchequelle.

## UI

Timeline, gruppiert nach Heute / Gestern / Wochentag.

Filter: Alle, Gespräch, Recherche, Aufgaben, Projekte, Kommunikation, Entscheidungen, Freigaben, Ausführung.

Gesprächseinträge stammen aus dem Conversation Archive und sind chronologisch auffindbar. Fulltext-Suche über `ConversationMessage` ist aktiv, inklusive ChatGPT-Import (`origin=chatgpt_import`). `conversationArchive.search` filtert nach Query, Projekt, Datum, Rolle und Origin.

Die Oberfläche zeigt nicht den kompletten Chat. Das Archiv bleibt die Stelle für ältere Kommunikation.
