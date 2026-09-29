import { AppleMailPostfach } from "@/connectors/mail/apple";
import { sendeEntwurf } from "@/services/mail/entwuerfe";

const postfach = new AppleMailPostfach();

/** Worker-Handler „mail.send“: versendet einen Entwurf; ohne Dauerfreigabe wird nichts gesendet. */
export async function mailSendWorkHandler(item: {
  id: string;
  organizationId: string;
  jobId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
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
  if (result.status === "gesendet") return { ok: true, note: result.grund };
  if (result.status === "freigabe_noetig") return { ok: false, retry: false, note: `Freigabe nötig (${result.freigabeId}): ${result.grund}` };
  return { ok: false, retry: false, note: result.grund };
}
