import type { AIRole } from "@/types/ai";

/** Zentrale Default-Modelle. Organization-Overrides liegen in AiProviderConfig. */
export const DEFAULT_MODELS_BY_ROLE: Record<AIRole, string> = {
  master: "gpt-6-astra",
  simple: "gpt-6-astra",
  sensitive: "gpt-6-astra",
  fallback: "mock-fallback",
};

export const OPENAI_DEFAULT_MODEL = DEFAULT_MODELS_BY_ROLE.master;

/** GPT-5/6 und o-Modelle akzeptieren nur die Default-Temperatur. */
export function modelAllowsCustomTemperature(model: string): boolean {
  const id = model.trim().toLowerCase();
  if (id.startsWith("gpt-6") || id.startsWith("gpt-5")) return false;
  if (/^o[1-4]/.test(id)) return false;
  return true;
}

export function defaultModelFor(providerId: string, role: AIRole, configured?: string | null): string {
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  if (providerId === "mock") {
    return `mock-${role}`;
  }
  if (providerId === "openai") {
    return role === "fallback" ? DEFAULT_MODELS_BY_ROLE.simple : DEFAULT_MODELS_BY_ROLE[role];
  }
  return DEFAULT_MODELS_BY_ROLE[role];
}
