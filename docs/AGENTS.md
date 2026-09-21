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
| Research | Mock-Firmen und Mock-Ansprechpartner |
| Communication | Mail-Entwürfe, kein Versand |
| Task | Folgeaufgaben / Wiedervorlagen |
| Project | Projektkontext laden |

## Vorbereitet (Registry, nicht vollständig)

Calendar, Document, Meeting, Watch, Contact, Browser/Computer, Quality.

Quality läuft im Sponsoren-Demo als interne Prüfung (keine fälschlich „versendeten“ Mails).

## Prinzip

Keine hart verdrahteten Workflows für jede Aufgabe. Der Sponsoren-Demo ist der erste echte Ablauf, den der Master über Registry-Agenten zusammensetzt.
