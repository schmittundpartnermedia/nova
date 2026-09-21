# Architektur

NOVA ist ein modularer Monolith: eine Next.js-Anwendung, eine SQLite-Datenbank, ein gemeinsames Memory, unsichtbare Spezialagenten hinter einem Master.

## Grundsatz

Der Benutzer spricht ausschließlich mit NOVA. Agenten, Provider, Jobs und Connectoren bleiben intern.

## Schichten

```
UI (Digital Human, Composer, Archiv)
        ↓
API / Bridge
        ↓
Master Agent
        ↓
Agent Registry  →  Research, Communication, Task, Project, … 
        ↓
Services (Memory, Jobs, Approvals, Archive, Retrieval, Import, Avatar Animation)
        ↓
Providers / Connectors
        ↓
Prisma / SQLite
```

Der zentrale Avatar ist ein Three.js Digital Human (glTF Morph Targets + Bones).
Siehe [Avatar Engine](AVATAR_ENGINE.md). Das Referenzfoto ist keine Runtime-Geometrie.

## Tenant-Modell

Jede NOVA-Welt gehört zu einer `Organization`.

Die persönliche V1 läuft als Organization `Joachim` (slug: `joachim`). Das ist Tenant Nummer 1.

Später können weitere Organizations in derselben Software existieren, ohne den Code zu kopieren.

Alle Business-Daten tragen `organization_id`. Abfragen sind tenant-aware, z. B. `getProjects(organizationId)`.

Die normale Oberfläche zeigt **keine** Mandantenwahl.

## Persistenz

Jobs, Steps, Memory, Aktivitäten, Entwürfe und Freigaben liegen in SQLite. Ein Neustart löscht sie nicht.

## Hybrid AI

Pro Organization können Rollen konfiguriert werden:

- `master` – komplexe Aufgaben
- `simple` – günstigere / kürzere Aufgaben
- `sensitive` – lokale / sensible Aufgaben
- `fallback` – wenn der Hauptprovider nicht erreichbar ist

Memory ist **nicht** an einen AI Provider gebunden.

## Ehrlichkeit

Vorbereitete Aktionen werden als `prepared` oder `suggested` gespeichert.

`executed` ist nur erlaubt, wenn eine echte externe Aktion stattgefunden hat.

## Roadmap (nicht in V1)

- Echte Anthropic- / Local-AI-Anbindung
- Echte Mail- und Kalender-Connectoren
- Semantische Suche / Embeddings
- ChatGPT-Export-Extraktion (Personen, Firmen, Entscheidungen)
- MCP-Server-Prozess
- Dauerfreigaben mit Limits in der Praxis
- Watch-Agent (Follow-up-Überwachung)
- Onboarding weiterer Organizations
