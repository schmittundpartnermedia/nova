import { ImapPostfach } from "@/connectors/mail/imap";
import { resolveHead } from "@/providers/ai/head";
import { postfachWache } from "@/services/kampagnen/wache";

const postfach = new ImapPostfach();

/** Worker-Handler „postfach.wache“. */
export async function postfachWacheWorkHandler(item: {
  organizationId: string;
}): Promise<{ ok: boolean; retry?: boolean; note?: string }> {
  const kopf = await resolveHead(item.organizationId);
  const result = await postfachWache({ organizationId: item.organizationId, postfach, kopf });
  return {
    ok: true,
    note: result.weiter ? `${result.neueAntworten} neue Antwort(en)` : "keine Kampagnen-Mails mehr zu beobachten",
  };
}
