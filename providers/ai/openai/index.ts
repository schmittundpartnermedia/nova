import OpenAI from "openai";
import type { HeadProvider, HeadTurnInput, HeadTurnOutput, HealthCheckResult } from "@/types/ai";
import { HEAD_MODEL } from "@/providers/ai/models";
import { bucheVerbrauch } from "@/lib/kosten";
import { hasOpenAIApiKey, publicErrorMessage } from "@/lib/secrets";

const HEALTH_TTL_MS = 30_000;

type CachedHealth = {
  at: number;
  result: HealthCheckResult;
};

function resolveModel(input?: { model?: string }): string {
  return input?.model?.trim() || HEAD_MODEL;
}

export class OpenAIProvider implements HeadProvider {
  id = "openai";
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

  async headTurn(input: HeadTurnInput): Promise<HeadTurnOutput> {
    const model = resolveModel(input);
    try {
      const tools = input.tools.map((tool) => ({
        type: "function" as const,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: true as const,
      }));

      const response = await this.getClient().responses.create({
        model,
        instructions: input.instructions,
        input: input.input.map((item) => {
          if ("type" in item && item.type === "function_call_output") {
            return {
              type: "function_call_output" as const,
              call_id: item.call_id,
              output: item.output,
            };
          }
          const message = item as { role: "user" | "assistant"; content: string };
          return {
            role: message.role,
            content: message.content,
          };
        }),
        tools,
        ...(input.previousResponseId ? { previous_response_id: input.previousResponseId } : {}),
      });
      bucheVerbrauch({
        art: "kopf",
        modell: model,
        eingabeTokens: response.usage?.input_tokens,
        gecachteTokens: response.usage?.input_tokens_details?.cached_tokens,
        ausgabeTokens: response.usage?.output_tokens,
      });

      const toolCalls = (response.output ?? [])
        .filter((item) => item.type === "function_call")
        .map((item) => {
          const call = item as {
            call_id?: string;
            name?: string;
            arguments?: string;
          };
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
          } catch {
            args = {};
          }
          return {
            callId: String(call.call_id ?? ""),
            name: String(call.name ?? ""),
            arguments: args,
          };
        })
        .filter((call) => call.callId && call.name);

      const text =
        typeof response.output_text === "string"
          ? response.output_text.trim()
          : (response.output ?? [])
              .filter((item) => item.type === "message")
              .map((item) => {
                const message = item as {
                  content?: Array<{ type?: string; text?: string }>;
                };
                return (message.content ?? [])
                  .filter((part) => part.type === "output_text" || part.type === "text")
                  .map((part) => part.text ?? "")
                  .join("");
              })
              .join("")
              .trim();

      return {
        responseId: response.id,
        text,
        toolCalls,
        model: response.model ?? model,
        provider: this.id,
      };
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
          ? `OpenAI erreichbar. Konfiguriertes Modell: ${HEAD_MODEL}.`
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
