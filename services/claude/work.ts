import { echterClaude } from "@/lib/claude/runner";
import { fuehreAuftragAus, fuehreLiveAus } from "@/services/claude";

/** Worker-Handler „claude.lauf“ und „claude.live“ – je ein Versuch, kein automatischer zweiter. */
export async function claudeLaufWorkHandler(item: { payload: Record<string, unknown> }) {
  const auftrag = await fuehreAuftragAus({ auftragId: String(item.payload.auftragId ?? ""), claude: echterClaude });
  return { ok: auftrag.status === "fertig", retry: false, note: auftrag.fehler ?? auftrag.status };
}

export async function claudeLiveWorkHandler(item: { payload: Record<string, unknown> }) {
  const auftrag = await fuehreLiveAus({ auftragId: String(item.payload.auftragId ?? "") });
  return { ok: auftrag.status === "live", retry: false, note: auftrag.fehler ?? auftrag.status };
}
