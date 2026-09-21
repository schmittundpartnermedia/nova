import OpenAI from "openai";
import { hasOpenAIApiKey, publicErrorMessage } from "@/lib/secrets";
import {
  getNovaVoiceConfig,
  resolveVoiceName,
  resolveVoiceSpeed,
} from "@/providers/voice/config";
import { prepareTextForSpeech } from "@/services/voice/prepare-text";
import type {
  VoiceHealthCheckResult,
  VoiceProvider,
  VoiceSynthesizeInput,
  VoiceSynthesizeResult,
} from "@/types/voice";
import { VoiceUnavailableError } from "@/types/voice";

const HEALTH_TTL_MS = 30_000;

export class OpenAIVoiceProvider implements VoiceProvider {
  id = "openai";
  name = "OpenAIVoiceProvider";
  private client: OpenAI | null | undefined;
  private healthCache: { at: number; result: VoiceHealthCheckResult } | null = null;

  private getClient(): OpenAI {
    if (this.client) return this.client;
    if (!hasOpenAIApiKey()) {
      throw new VoiceUnavailableError("Sprachausgabe momentan nicht verfügbar.");
    }
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    return this.client;
  }

  stop(): void {
    // Abbruch läuft über den Request-AbortSignal des API-Routes.
  }

  async synthesize(input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResult> {
    const spoken = prepareTextForSpeech(input.text, { finalize: true });
    if (!spoken) {
      throw new VoiceUnavailableError("Kein sprechbarer Text.");
    }

    const config = getNovaVoiceConfig();
    const voice = resolveVoiceName(input.voice);
    const speed = resolveVoiceSpeed(input.speed ?? config.speed);

    try {
      const response = await this.getClient().audio.speech.create(
        {
          model: config.model,
          voice,
          input: spoken,
          instructions: config.instructions,
          response_format: config.responseFormat,
          speed,
        },
        input.signal ? { signal: input.signal } : undefined,
      );
      const audio = Buffer.from(await response.arrayBuffer());
      return {
        audio,
        mimeType: "audio/wav",
        visemes: undefined,
        provider: this.id,
        model: config.model,
        voice,
      };
    } catch (error) {
      if (input.signal?.aborted) {
        throw new VoiceUnavailableError("Sprachausgabe abgebrochen.");
      }
      throw new VoiceUnavailableError(publicErrorMessage(error));
    }
  }

  async healthCheck(): Promise<VoiceHealthCheckResult> {
    if (this.healthCache && Date.now() - this.healthCache.at < HEALTH_TTL_MS) {
      return this.healthCache.result;
    }

    const config = getNovaVoiceConfig();
    const base = {
      provider: this.id,
      model: config.model,
      voice: config.voice,
    };

    if (!hasOpenAIApiKey()) {
      const result = {
        ...base,
        ok: false,
        message: "Kein OPENAI_API_KEY gesetzt.",
      };
      this.healthCache = { at: Date.now(), result };
      return result;
    }

    const result = {
      ...base,
      ok: true,
      message: `OpenAI Speech bereit (${config.model} / ${config.voice} / ${config.speed}x).`,
    };
    this.healthCache = { at: Date.now(), result };
    return result;
  }
}
