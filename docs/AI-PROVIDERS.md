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
| MockAIProvider | Tests, Fallback, Demo, Offline |
| OpenAIProvider | Aktiv für die Organization Joachim, Key nur über `OPENAI_API_KEY` |
| AnthropicProvider | Interface, nicht angebunden |
| LocalAIProvider | Interface für Ollama / LM Studio, nicht angebunden |

## Konfiguration

`AiProviderConfig` gehört zur Organization.

Rollen: `master`, `simple`, `sensitive`, `fallback`.

Default-Modelle liegen zentral in `providers/ai/models.ts` und können pro Organization überschrieben werden.

Aktuell (Joachim):

- `master` → OpenAI `gpt-6-astra` (nur Coding, Computer, tiefe Recherche)
- `simple` → OpenAI `gpt-6-sol` (Gespräch, Wissen, Alltag)
- `sensitive` → OpenAI `gpt-6-sol`
- `fallback` → Mock

Wenn ein konfigurierter Provider nicht gesund ist, wird der Fallback der Organization verwendet. Eine Fallback-Antwort darf keine echte Modellantwort vortäuschen. Die UI unterscheidet `openai`, `mock`, `fallback` und `error`.

Secrets ausschließlich über Environment Variables (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LOCAL_AI_BASE_URL`). Niemals `NEXT_PUBLIC_OPENAI_API_KEY`.

## Wechsel

Memory, Kontakte, Projekte, Aufgaben, Archiv, Dokumente, Kommunikation und Entscheidungen bleiben beim Provider-Wechsel erhalten.
