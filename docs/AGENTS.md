# Agenten

NOVA Master ist die einzige sichtbare Intelligenz. Spezialagenten sind intern.

## Registry

Jeder Agent beschreibt:

- `id`, `name`, `description`
- `capabilities`
- `requiredTools`
- `inputSchema` / `outputSchema`
- `riskLevel`
- `implemented`

Der Master wählt Agenten dynamisch anhand dieser Metadaten und eines Plans vom AI Provider.

## V1 implementiert

| Agent | Aufgabe |
| --- | --- |
| Master | Intent, Plan, Orchestrierung, Memory, Archiv, Approval |
| Research | Interne Recherche; ohne Search Connector keine erfundenen Live-Treffer |
| Communication | Mail-Entwürfe, kein Versand |
| Task | Folgeaufgaben / Wiedervorlagen |
| Project | Projektkontext laden |
| Coding | Softwareentwicklung: plant, delegiert an Cursor Agent CLI, prüft Git/Tests/Browser, iteriert |
| Computer | Lokale Mac-Steuerung über Desktop Service: Git, Dateien, Shell, Prozesse, Playwright-Browser, Cursor CLI |

## Vorbereitet (Registry, nicht vollständig)

Calendar, Document, Meeting, Watch, Contact, Quality.

Accessibility- und Screen-Capture-Steuerung sind als Native Helper vorbereitet und brauchen macOS-Permissions.

Quality läuft im Sponsoren-Demo als interne Prüfung (keine fälschlich „versendeten“ Mails).

## Prinzip

Keine hart verdrahteten Workflows für jede Aufgabe. Der Sponsoren-Demo ist der erste echte Ablauf, den der Master über Registry-Agenten zusammensetzt.
