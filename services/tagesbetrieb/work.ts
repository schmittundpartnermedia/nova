import { AppleMailPostfach } from "@/connectors/mail/apple";
import { echterGebietsScanner } from "@/lib/leads/scanner";
import { fuehreTagessucheAus, planeTagesbetriebTick, tagesbetriebTick, TICK_MS } from "@/services/tagesbetrieb";
import { echterMxPruefer } from "@/services/tagesbetrieb/pruefen";

const postfach = new AppleMailPostfach();

/** Worker-Handler „tagesbetrieb.tick“: ein Takt, dann den nächsten planen (solange eingeschaltet). */
export async function tagesbetriebTickWorkHandler(item: { organizationId: string }): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  const jetzt = new Date();
  let note = "";
  let weiter = true;
  try {
    const result = await tagesbetriebTick({ organizationId: item.organizationId, jetzt, postfach, mx: echterMxPruefer });
    note = result.aktion;
    weiter = result.weiter;
  } catch (error) {
    note = `Fehler: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (weiter) await planeTagesbetriebTick(item.organizationId, new Date(jetzt.getTime() + TICK_MS));
  return { ok: !note.startsWith("Fehler"), retry: false, note };
}

/** Worker-Handler „tagesbetrieb.suche“: nächste Branche im Suchgebiet vollständig suchen. */
export async function tagesbetriebSucheWorkHandler(item: {
  organizationId: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  const branche = String(item.payload.branche ?? "").trim();
  if (!branche) return { ok: false, retry: false, note: "tagesbetrieb.suche ohne Branche." };
  const result = await fuehreTagessucheAus({ organizationId: item.organizationId, branche, runner: echterGebietsScanner, mx: echterMxPruefer });
  return result.ok
    ? { ok: true, note: `${branche}: ${result.gefunden} Betriebe, ${result.neuImVorrat} neu im Vorrat, ${result.anfragen ?? "?"} Anfragen` }
    : { ok: false, retry: false, note: result.grund };
}
