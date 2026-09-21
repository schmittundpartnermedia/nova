# NOVA

Persönlicher KI-Business-Assistent. Lokal. Eigenständig.

NOVA ist nicht rankPilot und nicht SURI. NOVA ist ein eigener Assistent für den Geschäftsalltag.

Die Oberfläche besteht praktisch nur aus NOVA: einem ruhigen Orb, einer Eingabezeile, einem Mikrofon und einem dezenten Archiv.

## Voraussetzungen

- Node.js 20+
- npm

## Installation

```bash
cd "/Volumes/My Book 24/NOVA"
cp .env.example .env
npm install
npx prisma migrate dev --name init
npx prisma db seed
```

## Start

```bash
npm run dev
```

Dann im Browser: [http://localhost:3000](http://localhost:3000)

## Demo (V1)

In das Eingabefeld:

```text
Finde 10 potenzielle Sponsoren und bereite die Ansprache vor.
```

NOVA erzeugt intern einen Job, Mock-Unternehmen, Mock-Kontakte, Mail-Entwürfe, eine Freigabeanfrage, Memory und Archiv-Einträge.

Es findet **keine** echte Recherche statt. Es wird **keine** E-Mail versendet.

## Wichtige Befehle

```bash
npm run dev          # Entwicklungsserver
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run build        # Produktionsbuild
npm run verify       # Demo- und Persistenzprüfung
npx prisma studio    # Datenbank ansehen
```

## Dokumentation

- [Architektur](docs/ARCHITECTURE.md)
- [Agenten](docs/AGENTS.md)
- [Memory](docs/MEMORY.md)
- [AI Provider](docs/AI-PROVIDERS.md)
- [Connectoren](docs/CONNECTORS.md)
- [ChatGPT Bridge](docs/CHATGPT-BRIDGE.md)
- [Archiv](docs/ARCHIVE.md)
- [Security](docs/SECURITY.md)

## V1-Grenzen

- AI: `OpenAIProvider` (Mock bleibt Fallback/Tests)
- Recherche: kein echter Search Connector; keine erfundenen Live-Treffer
- Mail/Kalender/Drive: nur Interfaces + Mocks
- Spracheingabe: vorbereitet (Web Speech API, falls der Browser sie anbietet)
- Sprachausgabe: OpenAI `gpt-4o-mini-tts`, lokal ein- und ausschaltbar
- Multi-Tenant: technisch vorbereitet, in der UI unsichtbar
