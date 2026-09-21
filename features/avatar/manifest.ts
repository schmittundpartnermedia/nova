import type { NovaAvatarReadiness } from "@/types/avatar";
import {
  DEVELOPMENT_RIG_URL,
  PRODUCTION_AVATAR_URL,
  PRODUCTION_MANIFEST_URL,
} from "@/features/avatar/acceptance";

export type NovaAvatarQuality = "development" | "production";

export type NovaAvatarManifest = {
  id: "nova";
  version: string;
  type: "digital-human";
  asset: string;
  rigProfile: "arkit-52";
  quality: NovaAvatarQuality;
  validated: boolean;
  status: NovaAvatarReadiness;
  activeAsset: string;
};

export const DEVELOPMENT_MANIFEST: NovaAvatarManifest = {
  id: "nova",
  version: "dev-rig",
  type: "digital-human",
  asset: DEVELOPMENT_RIG_URL,
  rigProfile: "arkit-52",
  quality: "development",
  validated: false,
  status: "DEVELOPMENT_RIG",
  activeAsset: DEVELOPMENT_RIG_URL,
};

export const MISSING_PRODUCTION_MANIFEST: NovaAvatarManifest = {
  id: "nova",
  version: "0.0.0-unvalidated",
  type: "digital-human",
  asset: PRODUCTION_AVATAR_URL,
  rigProfile: "arkit-52",
  quality: "development",
  validated: false,
  status: "FINAL_AVATAR_MISSING",
  activeAsset: DEVELOPMENT_RIG_URL,
};

export function isProductionReady(manifest: NovaAvatarManifest): boolean {
  return manifest.quality === "production" && manifest.validated === true && manifest.status === "PRODUCTION";
}

export async function loadAvatarManifest(): Promise<NovaAvatarManifest> {
  if (typeof fetch === "undefined") return MISSING_PRODUCTION_MANIFEST;
  try {
    const response = await fetch(PRODUCTION_MANIFEST_URL, { cache: "no-store" });
    if (!response.ok) return MISSING_PRODUCTION_MANIFEST;
    const raw = (await response.json()) as Partial<NovaAvatarManifest>;
    return normalizeManifest(raw);
  } catch {
    return MISSING_PRODUCTION_MANIFEST;
  }
}

export function normalizeManifest(raw: Partial<NovaAvatarManifest>): NovaAvatarManifest {
  const validated = raw.validated === true;
  const quality = raw.quality === "production" ? "production" : "development";
  if (!validated || quality !== "production") {
    return {
      ...MISSING_PRODUCTION_MANIFEST,
      version: typeof raw.version === "string" ? raw.version : MISSING_PRODUCTION_MANIFEST.version,
    };
  }
  return {
    id: "nova",
    version: typeof raw.version === "string" ? raw.version : "1.0.0",
    type: "digital-human",
    asset: typeof raw.asset === "string" ? raw.asset : PRODUCTION_AVATAR_URL,
    rigProfile: "arkit-52",
    quality: "production",
    validated: true,
    status: "PRODUCTION",
    activeAsset: typeof raw.activeAsset === "string" ? raw.activeAsset : PRODUCTION_AVATAR_URL,
  };
}
