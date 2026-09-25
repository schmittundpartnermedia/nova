import { PrismaClient } from "@prisma/client";
import { connectAppleMail } from "@/services/mail/apple-connect";
import { getMailCapabilityMap } from "@/services/mail/capabilities";
import { getMailProvider } from "@/connectors/registry";
import { AppleMailProvider, discardOutgoingMessage, inspectOutgoingMessage } from "@/connectors/mail/apple";
import { messageDetailScript, parseAttachments, parseDetail } from "@/lib/mail/apple";
import { runMailAppleScript } from "@/services/mail/apple-events";
import { searchMail } from "@/services/mail/search";
import { deliverApprovedDraft } from "@/services/mail/send";
import { archiveMailMessage } from "@/services/mail/actions";
import { scanWatch } from "@/agents/watch";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const organization = await prisma.organization.findUnique({ where: { slug: "joachim" } });
  assert(organization, "Organisation joachim fehlt");
  const orgId = organization!.id;
  const connected = await connectAppleMail(orgId);
  if (!connected.ok) {
    console.log(JSON.stringify({ live: false, permission: connected.permission, reason: connected.reason, accounts: 0 }));
    return;
  }
  const accounts = await prisma.mailAccount.findMany({
    where: { organizationId: orgId, provider: "apple-mail", status: "connected" },
  });
  assert(accounts.length > 0, "Keine Apple-Mail-Accounts");
  assert(accounts.every((item) => item.credentialRef == null), "Apple-Mail-Account darf keine Credential-Referenz haben");
  assert(accounts.every((item) => !/password|token|keychain/i.test(item.capabilities)), "Capabilities enthalten Zugangsdaten");

  const provider = await getMailProvider(orgId);
  assert(provider instanceof AppleMailProvider, "Apple Mail ist nicht der aktive Provider");
  const folders = await provider.listFolders(orgId, accounts[0]!.id);
  assert(folders.length > 0, "Keine Mailboxen");

  const messages = await prisma.mailMessage.findMany({
    where: { organizationId: orgId, accountId: { in: accounts.map((item) => item.id) } },
    include: { attachments: true, thread: true },
    orderBy: { receivedAt: "desc" },
    take: 20,
  });
  assert(messages.length > 0, "Keine Nachricht synchronisiert");
  assert(messages.some((item) => item.normalizedText.trim().length > 10), "Kein Nachrichteninhalt");
  assert(messages.some((item) => item.internetMessageId), "Keine Message-ID");
  assert(messages.every((item) => item.threadId), "Nachricht ohne Thread");
  const withThreadHeader = messages.filter((item) => /in-reply-to|references/i.test(item.headersJson));
  assert(withThreadHeader.length > 0 || messages.every((item) => item.providerThreadId), "Thread-Basis fehlt");

  const sample = messages.find((item) => item.subject.split(/\s+/).some((word) => word.length > 4)) ?? messages[0]!;
  const token = sample.subject.split(/\s+/).find((word) => word.length > 4) ?? sample.fromAddress.split("@")[0]!;
  const found = await searchMail({ organizationId: orgId, query: token, limit: 5 });
  assert(found.some((item) => item.organizationId === orgId), "Lokale Suche ohne Treffer");

  const attachmentRows = messages.reduce((sum, item) => sum + item.attachments.length, 0);
  const liveMessage = await provider.getMessage(orgId, sample.accountId, sample.providerMessageId);
  assert(liveMessage, "Einzelnachricht nicht lesbar");
  assert(Array.isArray(liveMessage?.attachments), "Anhangsliste fehlt");
  const located = await runMailAppleScript(
    `tell application "Mail"
set takeN to count of messages of inbox
if takeN > 8 then set takeN to 8
repeat with i from 1 to takeN
  try
    set m to message i of inbox
    set attCount to count of mail attachments of m
    if attCount > 0 then
      return (id of m as text) & "|||" & (id of account of mailbox of m as text) & "|||" & (name of mailbox of m) & "|||" & (attCount as text)
    end if
  end try
end repeat
return ""
end tell`,
    20_000,
  );
  if (!located.ok) throw new Error(located.error);
  const locatedFields = located.output.split("|||");
  assert(locatedFields.length >= 4, "Keine Nachricht mit Anhang im aktuellen Posteingang");
  const detail = await runMailAppleScript(messageDetailScript(locatedFields[1]!, locatedFields[2]!, locatedFields[0]!), 25_000);
  if (!detail.ok) throw new Error(detail.error);
  const liveAttachments = parseAttachments(parseDetail(detail.output).fields[11] || "");
  assert(liveAttachments.length > 0, "Anhang-Metadaten fehlen");
  assert(liveAttachments.every((item) => item.name.trim().length > 0 && item.mime.trim().length > 0), "Anhang ohne Name oder Typ");

  const draft = await provider.createDraft({
    organizationId: orgId,
    accountId: sample.accountId,
    to: accounts.find((item) => item.id === sample.accountId)?.emailAddress || sample.fromAddress,
    subject: "NOVA Prüfentwurf",
    body: "Dieser Entwurf prüft nur die Vorbereitung und wird nicht gesendet.",
    compose: "new",
  });
  assert(draft.providerMessageId && !draft.providerMessageId.startsWith("local-draft-"), "Apple-Mail-Entwurf fehlt");
  const inspected = await inspectOutgoingMessage(draft.providerMessageId);
  assert(inspected.ok && inspected.recipients > 0, "Entwurf ohne Empfänger");
  assert(await discardOutgoingMessage(draft.providerMessageId), "Entwurf nicht entfernt");

  const reply = await provider.createDraft({
    organizationId: orgId,
    accountId: sample.accountId,
    providerMessageId: sample.providerMessageId,
    to: sample.fromAddress,
    subject: `Re: ${sample.subject}`,
    body: "Kurze Antwort, nur als Entwurf.",
    compose: "reply",
  });
  assert(reply.providerMessageId && !reply.providerMessageId.startsWith("local-draft-"), "Reply-Entwurf fehlt");
  const replyState = await inspectOutgoingMessage(reply.providerMessageId);
  assert(replyState.ok && replyState.recipients > 0, "Reply ohne Empfänger");
  assert(await discardOutgoingMessage(reply.providerMessageId), "Reply-Entwurf nicht entfernt");

  const forwarded = await provider.createDraft({
    organizationId: orgId,
    accountId: sample.accountId,
    providerMessageId: sample.providerMessageId,
    to: accounts.find((item) => item.id === sample.accountId)?.emailAddress || sample.fromAddress,
    subject: `Fwd: ${sample.subject}`,
    body: "Weiterleitung nur vorbereitet.",
    compose: "forward",
  });
  assert(forwarded.providerMessageId && !forwarded.providerMessageId.startsWith("local-draft-"), "Forward-Entwurf fehlt");
  const forwardState = await inspectOutgoingMessage(forwarded.providerMessageId);
  assert(forwardState.ok, "Forward nicht vorbereitet");
  assert(await discardOutgoingMessage(forwarded.providerMessageId), "Forward-Entwurf nicht entfernt");

  const unsent = await deliverApprovedDraft({
    organizationId: orgId,
    communicationId: "missing-draft",
    approved: false,
  });
  assert(unsent.executed === false && unsent.status !== "VERIFIED", "Versand ohne Freigabe");
  const archived = await archiveMailMessage({
    organizationId: orgId,
    accountId: sample.accountId,
    providerMessageId: sample.providerMessageId,
    approved: false,
  });
  assert(archived.executed === false && archived.reason === "WAITING_FOR_APPROVAL", "Archiv ohne Freigabe");

  const caps = await getMailCapabilityMap(orgId);
  assert(caps.MAIL_CONNECTION.state === "AVAILABLE", caps.MAIL_CONNECTION.reason ?? "nicht verfügbar");
  const watch = await scanWatch(orgId);
  const chunks = await prisma.retrievalChunk.count({
    where: { organizationId: orgId, objectType: "mail_message" },
  });
  const memories = await prisma.memoryEntry.count({
    where: { organizationId: orgId, sourceType: "email" },
  });
  const knowledge = await prisma.mailAttachment.count({
    where: { organizationId: orgId, OR: [{ knowledgeSourceId: { not: null } }, { status: { in: ["indexed", "skipped", "pending"] } }] },
  });

  console.log(
    JSON.stringify({
      live: true,
      permission: "granted",
      accounts: accounts.length,
      mailboxes: folders.length,
      messages: messages.length,
      withBody: messages.filter((item) => item.normalizedText.trim().length > 10).length,
      withMessageId: messages.filter((item) => item.internetMessageId).length,
      threadHeaders: withThreadHeader.length,
      searchHits: found.length,
      attachmentRows,
      liveAttachments: liveAttachments.length,
      draft: true,
      reply: replyState.recipients > 0,
      forward: forwardState.ok,
      send: "BLOCKED_BY_APPROVAL",
      capabilities: caps.MAIL_CONNECTION.state,
      watch: Array.isArray(watch.newImportantMail),
      retrievalChunks: chunks,
      memories,
      knowledge,
      credentialRefs: accounts.filter((item) => item.credentialRef).length,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "verify-apple-mail");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
