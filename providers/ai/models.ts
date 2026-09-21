import type { AIRole } from "@/types/ai";

/** Zentrale Default-Modelle. Organization-Overrides liegen in AiProviderConfig. */
export const DEFAULT_MODELS_BY_ROLE: Record<AIRole, string> = {
  master: "gpt-4o",
  simple: "gpt-4o-mini",
  sensitive: "gpt-4o-mini",
  fallback: "mock-fallback",
};

export const OPENAI_DEFAULT_MODEL = DEFAULT_MODELS_BY_ROLE.master;

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
