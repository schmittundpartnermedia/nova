import { findMatchingPolicy } from "@/services/approvals";

/**
 * Freigabeliste: welche Apps NOVA bedienen darf.
 * Quelle: ApprovalPolicy macos.ui.click → conditions.allowedApps.
 * Leer = alle Apps erlaubt (bisheriges Verhalten).
 */
export async function listAllowedApps(organizationId: string): Promise<string[] | null> {
  const policy = await findMatchingPolicy({
    organizationId,
    actionType: "macos.ui.click",
  });
  if (!policy) return null;
  try {
    const conditions = JSON.parse(policy.conditions || "{}") as { allowedApps?: unknown };
    if (!Array.isArray(conditions.allowedApps) || !conditions.allowedApps.length) return null;
    return conditions.allowedApps.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return null;
  }
}

export async function isAppAllowed(organizationId: string, appName: string): Promise<boolean> {
  const allowed = await listAllowedApps(organizationId);
  if (!allowed) return true;
  const needle = appName.trim().toLowerCase();
  return allowed.some((item) => item.toLowerCase() === needle);
}
