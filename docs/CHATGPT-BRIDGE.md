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

## Import

`POST /api/import/chatgpt`

Pipeline:

Raw Chat → Conversation → Analyse (Platzhalter) → wenige Memory-Insights mit Quelle `chatgpt`

Es werden nicht alle Rohnachrichten als Memory übernommen.
