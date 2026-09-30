import { echterScanner } from "@/lib/leads/scanner";
import { fuehreKundensucheAus } from "@/services/leads";

/** Worker-Handler „scanner.lauf“. Kein zweiter Versuch: jeder Lauf kostet API-Anfragen. */
export async function scannerLaufWorkHandler(item: {
  organizationId: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  const result = await fuehreKundensucheAus({
    organizationId: item.organizationId,
    auftrag: {
      branche: String(item.payload.branche ?? ""),
      ort: String(item.payload.ort ?? ""),
      anzahl: Number(item.payload.anzahl ?? 0),
    },
    runner: echterScanner,
  });
  return result.ok
    ? { ok: true, note: `${result.anzahl} Betriebe → ${result.liste}` }
    : { ok: false, retry: false, note: result.grund };
}
