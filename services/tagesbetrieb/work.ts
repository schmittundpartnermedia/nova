import { AppleMailPostfach } from "@/connectors/mail/apple";
import { echterTageslauf } from "@/lib/leads/scanner";
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

/** Worker-Handler „tagesbetrieb.suche“: Scanner-Tageslauf, einlesen, prüfen. */
export async function tagesbetriebSucheWorkHandler(item: { organizationId: string }): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  const result = await fuehreTagessucheAus({ organizationId: item.organizationId, tageslauf: echterTageslauf, mx: echterMxPruefer });
  return result.ok
    ? { ok: true, note: `${result.kombis} Kombi(s), ${result.neu} neue Betriebe, ${result.geprueft} geprüft, ${result.verworfen} verworfen` }
    : { ok: false, retry: false, note: result.grund };
}
