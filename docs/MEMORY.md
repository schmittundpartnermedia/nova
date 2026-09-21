# Memory

Memory ist ein zentraler Service, kein Agent und keine Chat-History.

## Was gespeichert wird

Personen, Firmen, Projekte, Aufgaben, Entscheidungen, Meetings, Memos, Dokumente, Kommunikation, Termine, Recherche, Quellen, Follow-ups, Präferenzen, Gesprächsinhalte, Beziehungen.

## Herkunft

Jeder Memory-Eintrag trägt:

- `source_type` (`chatgpt` \| `nova` \| `email` \| `meeting` \| `document` \| `manual` \| `research` \| `calendar` \| `conversation_message`)
- `source_reference` (bei Gesprächen: `ConversationMessage.id`)
- `conversation_message_id` (optionale direkte Quelle)
- `source_url` (optional)
- `version` (bei Bestätigung/Aktualisierung)
- `created_at`

Memory ist nicht die Conversation. Smalltalk bleibt nur im Conversation Archive.

Suchergebnisse und Rohquellen werden nicht automatisch zu Memory. Nur bestätigte, langlebige Fakten aus der Recherche können als `source_type=research` übernommen werden – immer mit Source-ID/URL.

## Relationen

Beziehungen liegen in `MemoryRelation`, z. B.:

Person → `works_at` → Firma → `candidate_for` → Projekt → `drafted_for` → Anschreiben

## Retrieval

V1:

- strukturierte Filter
- Fulltext (`title`, `content`, `fulltext`)
- Relation Search

Vorbereitet:

- semantische Suche
- Embeddings (`embedding_ref` am Memory-Eintrag)

Memory-Suche ist immer auf `organization_id` begrenzt.

## Unabhängigkeit

Ein Wechsel des AI Providers ändert Memory nicht.
