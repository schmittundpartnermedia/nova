import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { mailExcerpt } from "@/lib/mail/html";
import { detectMailIntent } from "@/lib/mail/intent";
import { summarizeInbox } from "@/services/mail/inbox";
import { getMailThread, searchMail } from "@/services/mail/search";
import { prepareMailDraft } from "@/services/mail/draft";
import { deliverApprovedDraft } from "@/services/mail/send";
import { decideApproval } from "@/services/approvals";
import { prepareMailAccess } from "@/services/mail/access";
import { ensureAppleMailFresh } from "@/services/mail/apple-connect";

export async function answerMail(input: {
  organizationId: string;
  userRequest: string;
  onConsentPrompt?: () => void;
}) {
  assertOrganizationId(input.organizationId);
  const intent = detectMailIntent(input.userRequest);
  if (intent.kind === "inbox") {
    const access = await prepareMailAccess({
      organizationId: input.organizationId,
      capability: "MAIL_READ",
      action: "lesen",
      onConsentPrompt: input.onConsentPrompt,
    });
    if (!access.ready) {
      return { reply: access.reply, statusMessage: access.statusMessage, waitingApproval: false };
    }
    await ensureAppleMailFresh(input.organizationId).catch(() => undefined);
    const reply = await summarizeInbox(input.organizationId);
    return { reply, statusMessage: "Postfach geprüft.", waitingApproval: false };
  }
  if (intent.kind === "search" || intent.kind === "show") {
    const access = await prepareMailAccess({
      organizationId: input.organizationId,
      capability: "MAIL_SEARCH",
      action: "suchen",
      onConsentPrompt: input.onConsentPrompt,
    });
    if (!access.ready) {
      return { reply: access.reply, statusMessage: access.statusMessage, waitingApproval: false };
    }
    await ensureAppleMailFresh(input.organizationId).catch(() => undefined);
    const hits = await searchMail({ organizationId: input.organizationId, query: intent.query, limit: 5 });
    if (!hits.length) return { reply: "Dazu liegt im lokalen Postfach nichts.", statusMessage: "Keine Treffer.", waitingApproval: false };
    const top = hits[0];
    const thread = await getMailThread(input.organizationId, top.threadId);
    const count = thread?.messages.length ?? 1;
    const reply = `${top.fromName || top.fromAddress} – ${top.subject}\n${mailExcerpt(top.normalizedText)}\n\nVerlauf: ${count} Nachricht${count === 1 ? "" : "en"}.`;
    return { reply, statusMessage: "Mail gefunden.", waitingApproval: false };
  }
  if (intent.kind === "draft") {
    const draft = await prepareMailDraft({ organizationId: input.organizationId, userRequest: input.userRequest });
    return {
      reply: draft.reply,
      statusMessage: "Entwurf wartet auf Freigabe.",
      waitingApproval: true,
      approvalId: "approvalId" in draft ? draft.approvalId : undefined,
    };
  }
  if (intent.kind === "send-confirm") {
    const pending = await prisma.approvalRequest.findFirst({
      where: { organizationId: input.organizationId, status: "pending", actionType: { in: ["mail.send", "mail.send.batch"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!pending) {
      return { reply: "Es liegt kein Versand zur Freigabe vor. Es wurde nichts gesendet.", statusMessage: "Kein Versand.", waitingApproval: false };
    }
    await decideApproval({ organizationId: input.organizationId, approvalId: pending.id, status: "approved" });
    const payload = JSON.parse(pending.payload) as { communicationIds?: string[] };
    const ids = payload.communicationIds ?? [];
    let verified = 0;
    for (const communicationId of ids) {
      const result = await deliverApprovedDraft({ organizationId: input.organizationId, communicationId, approved: true });
      if (result.status === "VERIFIED") verified += 1;
    }
    if (!verified) {
      return {
        reply: "Freigabe ist erfasst. Der Provider hat den Versand nicht bestätigt. Status: fehlgeschlagen.",
        statusMessage: "Versand nicht bestätigt.",
        waitingApproval: false,
      };
    }
    return { reply: verified === 1 ? "Die Mail ist versendet und vom Provider bestätigt." : `${verified} Mails sind versendet und bestätigt.`, statusMessage: "Versand bestätigt.", waitingApproval: false };
  }
  return { reply: "Dazu habe ich keinen Mailauftrag erkannt.", statusMessage: "Kein Mailauftrag.", waitingApproval: false };
}
