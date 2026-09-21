import type { FacialAnimationProvider, FacialProviderHealth } from "@/types/facial";

export class FutureLocalFacialModelProvider implements FacialAnimationProvider {
  id = "local-facial-model" as const;
  name = "FutureLocalFacialModelProvider";

  async initialize(): Promise<void> {}

  async healthCheck(): Promise<FacialProviderHealth> {
    return {
      ok: false,
      provider: this.id,
      available: false,
      message: "Lokales Facial-Modell ist als zukünftiger Provider vorbereitet.",
    };
  }

  dispose() {}
}
