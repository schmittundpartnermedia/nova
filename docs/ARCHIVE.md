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

## Deep Links

`external_reference` und `external_url` führen später zur Original-Mail, zum Termin, zur Datei. In V1 sind sie leer, weil keine echten Connectoren verbunden sind.

## UI

Timeline, gruppiert nach Heute / Gestern / Wochentag.

Filter: Alle, Gespräch, Recherche, Aufgaben, Projekte, Kommunikation, Entscheidungen, Freigaben, Ausführung.

Gesprächseinträge stammen aus dem Conversation Archive und sind chronologisch auffindbar. Fulltext-Suche über `ConversationMessage` ist vorbereitet und aktiv.

Die Oberfläche zeigt nicht den kompletten Chat. Das Archiv bleibt die Stelle für ältere Kommunikation.
