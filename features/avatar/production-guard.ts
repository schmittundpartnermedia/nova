import type { NovaAvatarManifest } from "@/features/avatar/manifest";
import { isProductionReady } from "@/features/avatar/manifest";

export const FINAL_AVATAR_MISSING = "FINAL_AVATAR_MISSING" as const;

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export function allowDevelopmentRig(options?: { forceDevelopmentRig?: boolean }): boolean {
  if (options?.forceDevelopmentRig) return true;
  return !isProductionRuntime();
}

export function avatarReadiness(manifest: NovaAvatarManifest): typeof FINAL_AVATAR_MISSING | "PRODUCTION" | "DEVELOPMENT_RIG" {
  if (isProductionReady(manifest)) return "PRODUCTION";
  if (isProductionRuntime()) return FINAL_AVATAR_MISSING;
  return "DEVELOPMENT_RIG";
}

export function mustNotClaimDigitalHumanReady(manifest: NovaAvatarManifest): boolean {
  return !isProductionReady(manifest);
}

export function missingAvatarMessage(): string {
  return "FINAL_AVATAR_MISSING – Das fotorealistische NOVA-Asset ist nicht integriert. Die Development Rig ist kein Produktionsgesicht.";
}
