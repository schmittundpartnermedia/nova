import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import type { AIProvider, AIRole, AIRoutingDecision } from "@/types/ai";
import { defaultModelFor } from "@/providers/ai/models";
import { MockAIProvider } from "@/providers/ai/mock";
import { OpenAIProvider } from "@/providers/ai/openai";
import { AnthropicProvider } from "@/providers/ai/anthropic";
import { LocalAIProvider } from "@/providers/ai/local";

const providers: Record<string, AIProvider> = {
  mock: new MockAIProvider(),
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  local: new LocalAIProvider(),
};

export function getAIProviderById(id: string): AIProvider {
  const provider = providers[id];
  if (!provider) {
    throw new Error(`Unbekannter AI Provider: ${id}`);
  }
  return provider;
}

export async function resolveAIProvider(
  organizationId: string,
  role: AIRole = "master",
): Promise<{ provider: AIProvider; decision: AIRoutingDecision }> {
  assertOrganizationId(organizationId);

  const config = await prisma.aiProviderConfig.findUnique({
    where: {
      organizationId_role: { organizationId, role },
    },
  });

  const requested = config?.provider ?? "mock";
  const fallbackConfig = await prisma.aiProviderConfig.findUnique({
    where: {
      organizationId_role: { organizationId, role: "fallback" },
    },
  });

  let provider = providers[requested] ?? providers.mock;
  let fallback = false;
  let reason = `Organization-Konfiguration: Rolle ${role} → ${provider.id}`;

  if (requested !== "mock") {
    const health = await provider.healthCheck();
    if (!health.ok) {
      const fallbackId = fallbackConfig?.provider ?? "mock";
      provider = providers[fallbackId] ?? providers.mock;
      fallback = true;
      reason = `Provider ${requested} nicht einsatzbereit, Fallback auf ${provider.id}`;
    }
  }

  const model = defaultModelFor(
    provider.id,
    fallback ? "fallback" : role,
    fallback ? fallbackConfig?.model : config?.model,
  );

  return {
    provider,
    decision: {
      role,
      providerId: provider.id,
      requestedProviderId: requested,
      model,
      fallback,
      reason,
    },
  };
}

export function listAIProviders(): AIProvider[] {
  return Object.values(providers);
}
