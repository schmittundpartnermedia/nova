import OpenAI from "openai";
import type {
  AIProvider,
  AnalyzeImageInput,
  GenerateInput,
  GenerateOutput,
  HealthCheckResult,
  ReasonInput,
  ReasonOutput,
  ScreenPerception,
  StreamChunk,
  StructuredInput,
  ToolCallInput,
  ToolCallOutput,
} from "@/types/ai";
import { OPENAI_DEFAULT_MODEL, modelAllowsCustomTemperature } from "@/providers/ai/models";
import { hasOpenAIApiKey, publicErrorMessage, redactSecrets } from "@/lib/secrets";

const HEALTH_TTL_MS = 30_000;
const VISION_MODEL = process.env.NOVA_VISION_MODEL?.trim() || "gpt-4.1-mini";

type CachedHealth = {
  at: number;
  result: HealthCheckResult;
};

function resolveModel(input?: { model?: string }): string {
  return input?.model?.trim() || OPENAI_DEFAULT_MODEL;
}

function completionParams(input?: { model?: string; temperature?: number }) {
  const model = resolveModel(input);
  return {
    model,
    ...(modelAllowsCustomTemperature(model) ? { temperature: input?.temperature ?? 0.3 } : {}),
  };
}

function buildMessages(input: GenerateInput): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (input.system) {
    messages.push({ role: "system", content: input.system });
  }
  messages.push({ role: "user", content: input.prompt });
  return messages;
}

function normalizeImageDataUrl(input: AnalyzeImageInput): string {
  const mime = input.mimeType ?? "image/png";
  const raw = input.imageBase64.trim();
  if (raw.startsWith("data:")) return raw;
  return `data:${mime};base64,${raw.replace(/\s+/g, "")}`;
}

export class OpenAIProvider implements AIProvider {
  id = "openai";
  name = "OpenAIProvider";
  private client: OpenAI | null | undefined;
  private healthCache: CachedHealth | null = null;

  private getClient(): OpenAI {
    if (this.client) return this.client;
    if (!hasOpenAIApiKey()) {
      throw new Error("Kein OPENAI_API_KEY gesetzt.");
    }
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    return this.client;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const params = completionParams(input);
    try {
      const completion = await this.getClient().chat.completions.create({
        ...params,
        messages: buildMessages(input),
      });
      const text = completion.choices[0]?.message?.content?.trim() ?? "";
      return {
        text,
        provider: this.id,
        model: completion.model ?? params.model,
      };
    } catch (error) {
      throw new Error(publicErrorMessage(error));
    }
  }

  async reason(input: ReasonInput): Promise<ReasonOutput> {
    const model = resolveModel(input);
    const constraints = (input.constraints ?? []).join("\n- ");
    const generated = await this.generate({
      model,
      temperature: 0.2,
      system:
        "Du bist der Planungsanteil von NOVA. Antworte ausschließlich mit JSON: {\"reasoning\":\"...\",\"plan\":[\"...\"]}. Keine Secrets ausgeben.",
      prompt: `Ziel: ${input.goal}\n\nKontext:\n${input.context}${
        constraints ? `\n\nEinschränkungen:\n- ${constraints}` : ""
      }`,
    });
    try {
      const parsed = JSON.parse(generated.text) as { reasoning?: string; plan?: string[] };
      return {
        reasoning: parsed.reasoning ?? generated.text,
        plan: Array.isArray(parsed.plan) ? parsed.plan.map(String) : [],
        provider: this.id,
      };
    } catch {
      return {
        reasoning: generated.text,
        plan: [],
        provider: this.id,
      };
    }
  }

  async structuredOutput<T>(input: StructuredInput): Promise<T> {
    const params = completionParams({ model: input.model, temperature: 0.1 });
    try {
      const completion = await this.getClient().chat.completions.create({
        ...params,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Du antwortest ausschließlich mit gültigem JSON-Objekt. Schema: ${input.schemaName}. ${input.schemaDescription} Keine Markdown-Zäune, keine Secrets.`,
          },
          { role: "user", content: input.prompt },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      return JSON.parse(redactSecrets(raw)) as T;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Die Modellantwort war kein gültiges JSON.");
      }
      throw new Error(publicErrorMessage(error));
    }
  }

  async analyzeImage(input: AnalyzeImageInput): Promise<ScreenPerception> {
    const model = input.model?.trim() || VISION_MODEL;
    try {
      const completion = await this.getClient().chat.completions.create({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Du analysierst einen macOS-Screenshot für NOVA. Antworte nur JSON: {"summary":"...","windows":[{"title":"...","app":"...","focused":true}],"elements":[{"label":"...","role":"...","value":"..."}],"state":"..."}. Keine Passwörter, keine Inhalte sensibler Fenster (Banking, Keychain, 1Password) in summary/elements übernehmen — nur „sensibles Fenster“.',
          },
          {
            role: "user",
            content: [
              { type: "text", text: input.question },
              { type: "image_url", image_url: { url: normalizeImageDataUrl(input) } },
            ],
          },
        ],
      });
      const raw = completion.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(redactSecrets(raw)) as {
        summary?: string;
        windows?: Array<{ title?: string; app?: string; focused?: boolean }>;
        elements?: Array<{ label?: string; role?: string; value?: string }>;
        state?: string;
      };
      return {
        summary: String(parsed.summary ?? "").slice(0, 2000),
        windows: Array.isArray(parsed.windows)
          ? parsed.windows.slice(0, 20).map((item) => ({
              title: String(item.title ?? "").slice(0, 200),
              app: item.app ? String(item.app).slice(0, 120) : undefined,
              focused: Boolean(item.focused),
            }))
          : [],
        elements: Array.isArray(parsed.elements)
          ? parsed.elements.slice(0, 40).map((item) => ({
              label: String(item.label ?? "").slice(0, 200),
              role: item.role ? String(item.role).slice(0, 80) : undefined,
              value: item.value ? String(item.value).slice(0, 200) : undefined,
            }))
          : [],
        state: String(parsed.state ?? "").slice(0, 500),
        provider: this.id,
        model: completion.model ?? model,
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Vision-Antwort war kein gültiges JSON.");
      }
      throw new Error(publicErrorMessage(error));
    }
  }

  async toolCall(input: ToolCallInput): Promise<ToolCallOutput> {
    const params = completionParams({ model: input.model, temperature: 0.1 });
    try {
      const completion = await this.getClient().chat.completions.create({
        ...params,
        messages: [{ role: "user", content: input.prompt }],
        tools: input.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: true,
            },
          },
        })),
      });
      const message = completion.choices[0]?.message;
      const call = message?.tool_calls?.[0];
      if (call && call.type === "function") {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        return { tool: call.function.name, arguments: args, text: message?.content ?? undefined };
      }
      return { text: message?.content ?? undefined };
    } catch (error) {
      throw new Error(publicErrorMessage(error));
    }
  }

  async *stream(input: GenerateInput): AsyncIterable<StreamChunk> {
    const params = completionParams(input);
    try {
      const streamed = await this.getClient().chat.completions.create({
        ...params,
        stream: true,
        messages: buildMessages(input),
      });
      for await (const chunk of streamed) {
        const delta = chunk.choices[0]?.delta?.content ?? "";
        if (delta) {
          yield { delta, done: false };
        }
      }
      yield { delta: "", done: true };
    } catch (error) {
      throw new Error(publicErrorMessage(error));
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (this.healthCache && Date.now() - this.healthCache.at < HEALTH_TTL_MS) {
      return this.healthCache.result;
    }

    if (!hasOpenAIApiKey()) {
      const result = {
        ok: false,
        provider: this.id,
        message: "Kein OPENAI_API_KEY gesetzt.",
      };
      this.healthCache = { at: Date.now(), result };
      return result;
    }

    try {
      const models = await this.getClient().models.list();
      const first = models.data[0]?.id;
      const result = {
        ok: true,
        provider: this.id,
        message: first
          ? `OpenAI erreichbar. Konfiguriertes Modell: ${OPENAI_DEFAULT_MODEL}.`
          : "OpenAI erreichbar.",
      };
      this.healthCache = { at: Date.now(), result };
      return result;
    } catch (error) {
      const result = {
        ok: false,
        provider: this.id,
        message: publicErrorMessage(error),
      };
      this.healthCache = { at: Date.now(), result };
      return result;
    }
  }
}
