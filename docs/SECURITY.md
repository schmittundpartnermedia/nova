# Security

NOVA wird später auf sensible Business-Systeme zugreifen. V1 legt die Regeln fest, bevor echte Connectoren kommen.

## Secrets

Keine Secrets in der Datenbank im Klartext, wenn vermeidbar. Keine hardcodierten Keys. Nur Environment Variables.

Connector-Konfiguration speichert nicht-geheime JSON-Daten. Credentials gehören später in Env / Secret Store, scoped auf die Organization.

## Freigaben

Externe Aktionen brauchen `ApprovalRequest` oder eine gültige `ApprovalPolicy`.

Zentrale Prüfung: `authorizeExternalAction` in `services/approvals/authorize.ts` — vor jeder extern wirksamen Aktion (Master, Mail, Computer, Worker).

Dauerfreigaben (`ApprovalPolicy`) sind produktiv für:
- `mail.send.batch` (inkl. einzelner `mail.send`)
- `macos.ui.click`

mit `scope`, `conditions` (z. B. `allowedApps`, `allowedRecipientDomains`) und `limits` (z. B. `maxPerDay`). In der UI schaltbar und widerrufbar.

Unumkehrbare Aktionen (Löschen, Zahlungen, Veröffentlichen) sind **nie** per Dauerfreigabe freigebbar — immer Einzelfreigabe.

## Ehrlichkeit

Keine Fake-Erfolge. Kein „versendet“, wenn der MailProvider nicht wirklich gesendet hat. Keine stille Datenlöschung.

## Audit

Aktivitäten und Jobs sind persistent und tenant-aware.

## Multi-Tenant

Memory, Retrieval, Jobs, Activities und Knowledge (Sources, Items, Embeddings, Imports) einer Organization sind von anderen Organizations getrennt.

Dokumente und importierte ChatGPT-Verläufe sind untrusted Input. Inhalt darf keine Tools, Systemregeln oder Computer-/Coding-Agenten steuern. `.env`, Keys und Credentials werden nicht ingestiert und nicht an AI Provider gesendet.
