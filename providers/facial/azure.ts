import type { FacialAnimationProvider, FacialProviderHealth } from "@/types/facial";

export class AzureVisemeProvider implements FacialAnimationProvider {
  id = "azure-viseme" as const;
  name = "AzureVisemeProvider";

  async initialize(): Promise<void> {}

  async healthCheck(): Promise<FacialProviderHealth> {
    return {
      ok: false,
      provider: this.id,
      available: false,
      message: "Azure Viseme Provider ist vorbereitet, aber nicht angebunden.",
    };
  }

  dispose() {}
}
