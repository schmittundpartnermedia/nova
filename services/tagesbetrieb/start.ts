import { leseEinstellungen } from "@/services/tagesbetrieb/einstellungen";
import { planeTagesbetriebTick } from "@/services/tagesbetrieb";

/** Beim Start des Hintergrund-Läufers: ist der Tagesbetrieb eingeschaltet, den nächsten Takt planen. */
export async function tagesbetriebNachNeustart(): Promise<boolean> {
  const cfg = leseEinstellungen();
  if (!cfg.aktiv || !cfg.organizationId) return false;
  await planeTagesbetriebTick(cfg.organizationId, new Date(Date.now() + 30_000));
  return true;
}
