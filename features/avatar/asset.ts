export {
  PRODUCTION_AVATAR_URL as FINAL_NOVA_GLB_URL,
  DEVELOPMENT_RIG_URL as DEV_RIG_URL,
} from "@/features/avatar/acceptance";

export const NOVA_GLB_CANDIDATES = ["/nova/avatar/nova.glb", "/nova/dev-rig/nova-dev-rig.glb"] as const;

export function isDevelopmentRigUrl(url: string): boolean {
  return url.includes("dev-rig") || url.includes("nova-dev-rig");
}
