import { AppleMailPostfach } from "@/connectors/mail/apple";
import { sendeEntwurf } from "@/services/mail/entwuerfe";
import { nachKampagnenVersand } from "@/services/kampagnen";
import type { Postfach } from "@/services/mail/postfach";

type WorkItem = {
  id: string;
  organizationId: string;
  jobId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
};

/**
 * Worker-Handler „mail.send“: versendet einen Entwurf (Kampagnen-Mail nur mit Kampagnen-Freigabe).
 * Kein automatischer zweiter Versuch: ein halb gelaufener Versand darf nicht doppelt rausgehen.
 */
export function mailSendHandler(postfach: Postfach) {
  return async (item: WorkItem): Promise<{ ok: boolean; retry?: boolean; note?: string }> => {
    const entwurfId = String(item.payload.entwurfId ?? "");
    if (!entwurfId) {
      return { ok: false, retry: false, note: "mail.send ohne entwurfId." };
    }
    const result = await sendeEntwurf({
      organizationId: item.organizationId,
      entwurfId,
      postfach,
      jobId: item.jobId ?? undefined,
    });
    await nachKampagnenVersand(item.organizationId, entwurfId, {
      gesendet: result.status === "gesendet",
      grund: result.grund,
    });
    if (result.status === "gesendet") return { ok: true, note: result.grund };
    if (result.status === "freigabe_noetig") {
      return { ok: false, retry: false, note: `Freigabe nötig (${result.freigabeId}): ${result.grund}` };
    }
    return { ok: false, retry: false, note: result.grund };
  };
}

export const mailSendWorkHandler = mailSendHandler(new AppleMailPostfach());
