import { erinnere } from "@/services/termine";

/** Worker-Handler „termin.erinnerung“. */
export async function terminErinnerungWorkHandler(item: { organizationId: string; payload: Record<string, unknown>; now: Date }): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  const note = await erinnere({ organizationId: item.organizationId, terminId: String(item.payload.terminId ?? ""), beginn: String(item.payload.beginn ?? ""), jetzt: item.now });
  return { ok: true, note };
}
