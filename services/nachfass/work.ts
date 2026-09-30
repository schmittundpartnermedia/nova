import { nachfassTick } from "@/services/nachfass";

/** Worker-Handler „nachfass.tick“. */
export async function nachfassTickWorkHandler(item: { organizationId: string }): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  const result = await nachfassTick({ organizationId: item.organizationId });
  return { ok: true, note: result.weiter ? `${result.angelegt} Nachfass-Mail(s) geplant` : "keine Kampagne mit Nachfass mehr offen" };
}
