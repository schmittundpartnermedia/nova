import { hasOpenAIApiKey } from "@/lib/secrets";
import { OpenAIVoiceProvider } from "@/providers/voice/openai";
import { MockVoiceProvider } from "@/providers/voice/mock";
import type { VoiceProvider } from "@/types/voice";

const openai = new OpenAIVoiceProvider();
const mock = new MockVoiceProvider();

const providers: Record<string, VoiceProvider> = {
  openai,
  mock,
};

export function getVoiceProviderById(id: string): VoiceProvider {
  const provider = providers[id];
  if (!provider) {
    throw new Error(`Unbekannter Voice Provider: ${id}`);
  }
  return provider;
}

export function resolveVoiceProvider(): VoiceProvider {
  if (hasOpenAIApiKey()) return openai;
  return mock;
}

export function listVoiceProviders(): VoiceProvider[] {
  return Object.values(providers);
}
