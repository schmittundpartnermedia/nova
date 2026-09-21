export const NOVA_GLB_CANDIDATES = ["/nova/nova.glb", "/nova/dev-rig/nova-dev-rig.glb"] as const;

export const DEV_RIG_URL = "/nova/dev-rig/nova-dev-rig.glb";
export const FINAL_NOVA_GLB_URL = "/nova/nova.glb";

export function isDevelopmentRigUrl(url: string): boolean {
  return url.includes("dev-rig") || url.includes("nova-dev-rig");
}
