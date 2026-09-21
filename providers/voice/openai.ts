import OpenAI from "openai";
import { hasOpenAIApiKey, publicErrorMessage } from "@/lib/secrets";
import { NOVA_VOICE_CONFIG } from "@/providers/voice/config";
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

    try {
      const response = await this.getClient().audio.speech.create(
        {
          model: NOVA_VOICE_CONFIG.model,
          voice: NOVA_VOICE_CONFIG.voice,
          input: spoken,
          instructions: NOVA_VOICE_CONFIG.instructions,
          response_format: NOVA_VOICE_CONFIG.responseFormat,
          speed: NOVA_VOICE_CONFIG.speed,
        },
        input.signal ? { signal: input.signal } : undefined,
      );
      const audio = Buffer.from(await response.arrayBuffer());
      return {
        audio,
        mimeType: "audio/wav",
        visemes: undefined,
        provider: this.id,
        model: NOVA_VOICE_CONFIG.model,
        voice: NOVA_VOICE_CONFIG.voice,
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

    const base = {
      provider: this.id,
      model: NOVA_VOICE_CONFIG.model,
      voice: NOVA_VOICE_CONFIG.voice,
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
      message: `OpenAI Speech bereit (${NOVA_VOICE_CONFIG.model} / ${NOVA_VOICE_CONFIG.voice}).`,
    };
    this.healthCache = { at: Date.now(), result };
    return result;
  }
}
