# ChatGPT Bridge

NOVA besitzt nicht automatisch die ChatGPT-Historie. Externe Assistenten müssen NOVA gezielt fragen oder schreiben.

## REST (V1)

`POST /api/bridge/{tool}`

Tools:

- `memory.search` / `memory.save`
- `projects.search` / `projects.get` / `projects.update`
- `tasks.create` / `tasks.search` / `tasks.update`
- `contacts.search` / `contacts.save`
- `activities.search`
- `documents.search`
- `communications.search`

Jede Anfrage läuft im Kontext **einer** Organization. Keine organisationsübergreifenden Ergebnisse.

Katalog: `GET /api/bridge`

## MCP

`bridge/mcp` enthält das Vertragsgerüst. Ein eigener MCP-Prozess ist in V1 nicht gestartet.

## ChatGPT-Export-Import

Offizieller Datenexport (ZIP mit `conversations.json`). Keine Live-Synchronisation, kein Scraping, keine Session-Cookies.

Pipeline:

```
ChatGPT Export
  → Conversation Archive (vollständiger Verlauf, Original-Zeitstempel)
  → Knowledge Agent (strukturiertes Wissen)
  → Memory (nur dauerhaft relevantes)
```

Entry Points:

- Chat: „Importiere meinen ChatGPT Verlauf.“ → ZIP über + wählen
- `POST /api/import/chatgpt` (multipart ZIP, JSON-Pfad oder `conversations`)
- CLI: `npm run import:chatgpt -- --file /pfad/export.zip`

Nachrichten sind untrusted historical content. Secrets werden redaktiert. Prompt-Injection wird nur gespeichert, nie ausgeführt.

Import ist idempotent und inkrementell (external IDs, Checksums, Checkpoints). „NOVA Stop“ bricht ab; fertige Conversations bleiben.
