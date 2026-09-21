import { NOVA_VOICE_CONFIG } from "@/providers/voice/config";
import type {
  VoiceHealthCheckResult,
  VoiceProvider,
  VoiceSynthesizeInput,
  VoiceSynthesizeResult,
} from "@/types/voice";
import { VoiceUnavailableError } from "@/types/voice";

export class MockVoiceProvider implements VoiceProvider {
  id = "mock";
  name = "MockVoiceProvider";

  stop(): void {
    // no-op
  }

  async synthesize(_input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResult> {
    throw new VoiceUnavailableError("Sprachausgabe momentan nicht verfügbar.");
  }

  async healthCheck(): Promise<VoiceHealthCheckResult> {
    return {
      ok: false,
      provider: this.id,
      model: NOVA_VOICE_CONFIG.model,
      voice: NOVA_VOICE_CONFIG.voice,
      message: "Mock-Voice: keine Sprachausgabe.",
    };
  }
}
