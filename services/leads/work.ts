import { echterGebietsScanner } from "@/lib/leads/scanner";
import { fuehreGebietssucheAus } from "@/services/leads";
import { echterMxPruefer } from "@/services/tagesbetrieb/pruefen";

/** Worker-Handler „scanner.lauf“ (Gebietssuche auf Joachims Zuruf). Kein zweiter Versuch: jeder Lauf kostet API-Anfragen. */
export async function scannerLaufWorkHandler(item: {
  organizationId: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  const result = await fuehreGebietssucheAus({
    organizationId: item.organizationId,
    auftrag: {
      branche: String(item.payload.branche ?? ""),
      mitte: String(item.payload.mitte ?? ""),
      radiusKm: Number(item.payload.radiusKm ?? 0),
    },
    runner: echterGebietsScanner,
    mx: echterMxPruefer,
  });
  return result.ok
    ? { ok: true, note: `${result.gefunden} Betriebe, ${result.neuImVorrat} neu im Vorrat, ${result.anfragen ?? "?"} Anfragen → ${result.liste}` }
    : { ok: false, retry: false, note: result.grund };
}
