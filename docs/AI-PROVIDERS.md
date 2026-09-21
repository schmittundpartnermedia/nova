# AI Provider

NOVA darf nicht fest an OpenAI oder einen anderen einzelnen Anbieter gebunden sein.

## Interface

`AIProvider`

- `generate()`
- `reason()`
- `structuredOutput()`
- `toolCall()`
- `stream()`
- `healthCheck()`

## Implementierungen

| Provider | Status |
| --- | --- |
| MockAIProvider | V1 aktiv |
| OpenAIProvider | Interface, nicht angebunden |
| AnthropicProvider | Interface, nicht angebunden |
| LocalAIProvider | Interface für Ollama / LM Studio, nicht angebunden |

## Konfiguration

`AiProviderConfig` gehört zur Organization.

Rollen: `master`, `simple`, `sensitive`, `fallback`.

Wenn ein konfigurierter Provider nicht gesund ist, wird der Fallback der Organization verwendet.

Secrets ausschließlich über Environment Variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LOCAL_AI_BASE_URL`).

## Wechsel

Memory, Kontakte, Projekte, Aufgaben, Archiv, Dokumente, Kommunikation und Entscheidungen bleiben beim Provider-Wechsel erhalten.
