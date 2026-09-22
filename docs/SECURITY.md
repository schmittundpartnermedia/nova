# Security

NOVA wird später auf sensible Business-Systeme zugreifen. V1 legt die Regeln fest, bevor echte Connectoren kommen.

## Secrets

Keine Secrets in der Datenbank im Klartext, wenn vermeidbar. Keine hardcodierten Keys. Nur Environment Variables.

Connector-Konfiguration speichert nicht-geheime JSON-Daten. Credentials gehören später in Env / Secret Store, scoped auf die Organization.

## Freigaben

Externe Aktionen brauchen `ApprovalRequest`.

Dauerfreigaben (`ApprovalPolicy`) sind als Datenmodell vorbereitet: `scope`, `conditions`, `limits`, `created_at`, `revoked_at`. In V1 noch nicht produktiv genutzt.

## Ehrlichkeit

Keine Fake-Erfolge. Kein „versendet“, wenn der MailProvider nicht wirklich gesendet hat. Keine stille Datenlöschung.

## Audit

Aktivitäten und Jobs sind persistent und tenant-aware.

## Multi-Tenant

Memory, Retrieval, Jobs, Activities und Knowledge (Sources, Items, Embeddings, Imports) einer Organization sind von anderen Organizations getrennt.

Dokumente sind untrusted Input. Inhalt darf keine Tools, Systemregeln oder Computer-/Coding-Agenten steuern. `.env`, Keys und Credentials werden nicht ingestiert.
