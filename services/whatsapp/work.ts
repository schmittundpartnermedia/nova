import { AppleMailPostfach } from "@/connectors/mail/apple";
import { resolveHead } from "@/providers/ai/head";
import { planeWhatsappWache, sendeKampagnenNachricht, WACHE_INTERVALL_MS, whatsappWache } from "@/services/whatsapp";

const postfach = new AppleMailPostfach();

/** Worker-Handler „whatsapp.send“: eine Kampagnen-Nachricht. */
export async function whatsappSendWorkHandler(item: { organizationId: string; payload: Record<string, unknown> }): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  const note = await sendeKampagnenNachricht(item.organizationId, String(item.payload.nachrichtId ?? ""));
  return { ok: true, note };
}

/** Worker-Handler „whatsapp.wache“: Antworten der Angeschriebenen; plant sich selbst neu, solange es etwas zu beobachten gibt. */
export async function whatsappWacheWorkHandler(item: { organizationId: string; now: Date }): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  let note: string;
  let weiter = true;
  try {
    const kopf = await resolveHead(item.organizationId);
    const r = await whatsappWache({ organizationId: item.organizationId, kopf, postfach, jetzt: item.now });
    weiter = r.weiter;
    note = r.weiter ? `${r.neu} Gespräch(e) mit neuer Antwort` : "keine Kampagnen-Nachrichten mehr zu beobachten";
  } catch (e) {
    // Zernio nicht erreichbar: beim nächsten Lauf weiter, die Wache bleibt geplant.
    note = `Fehler: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (weiter) await planeWhatsappWache(item.organizationId, new Date(item.now.getTime() + WACHE_INTERVALL_MS));
  return { ok: true, note };
}
