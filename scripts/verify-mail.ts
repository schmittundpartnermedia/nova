import { PrismaClient } from "@prisma/client";
import { runMailUnitTests } from "@/lib/mail/unit-tests";
import { FixtureMailProvider } from "@/connectors/mail/fixture";
import { BlockedMailProvider } from "@/connectors/mail/blocked";
import { getMailProvider, isRealConnectorEnabled } from "@/connectors/registry";
import { storeMailSecret } from "@/services/mail/credentials";
import { startMailSync } from "@/services/mail/sync";
import { searchMail } from "@/services/mail/search";
import { summarizeInbox } from "@/services/mail/inbox";
import { prepareMailDraft } from "@/services/mail/draft";
import { deliverApprovedDraft } from "@/services/mail/send";
import { getMailCapabilityMap } from "@/services/mail/capabilities";
import { answerMail } from "@/services/mail/answer";
import { scanWatch } from "@/agents/watch";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  process.env.NOVA_MAIL_KEY = process.env.NOVA_MAIL_KEY || "verify-mail-key";
  const units = runMailUnitTests();
  if (units.length) throw new Error(units.join("; "));

  const orgA = await prisma.organization.upsert({
    where: { slug: "mail-verify-a" },
    update: { name: "Mail A" },
    create: { name: "Mail A", slug: "mail-verify-a" },
  });
  const orgB = await prisma.organization.upsert({
    where: { slug: "mail-verify-b" },
    update: { name: "Mail B" },
    create: { name: "Mail B", slug: "mail-verify-b" },
  });
  await prisma.mailFollowUp.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.mailAttachment.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.mailMessage.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.mailThread.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.mailAccount.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.mailAuditEvent.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.contact.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.company.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
  await prisma.project.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });

  const blocked = await getMailCapabilityMap(orgA.id);
  assert(blocked.MAIL_READ.state === "BLOCKED", "Ohne Konto muss Mail blockiert sein");
  assert(
    blocked.MAIL_READ.reason === "ACCOUNT_NOT_CONNECTED" ||
      blocked.MAIL_READ.reason === "AUTOMATION_PERMISSION_REQUIRED" ||
      blocked.MAIL_READ.reason === "PROVIDER_UNAVAILABLE",
    blocked.MAIL_READ.reason ?? "",
  );
  const provider = await getMailProvider(orgA.id);
  assert(provider instanceof BlockedMailProvider || provider.mock === false, "Produktiver Pfad darf keinen Mock als verfügbar melden");
  assert(provider.id !== "fixture-mail" && provider.id !== "mock-mail", "Fixture/Mock darf nicht produktiv sein");

  const project = await prisma.project.create({
    data: { organizationId: orgA.id, name: "rankPilot Partner", description: "Partnerschaft" },
  });
  const company = await prisma.company.create({
    data: { organizationId: orgA.id, name: "Hetzner", website: "https://hetzner.com", projectId: project.id },
  });
  await prisma.contact.create({
    data: {
      organizationId: orgA.id,
      firstName: "Anna",
      lastName: "Hetzner",
      email: "anna@hetzner.com",
      companyId: company.id,
      projectId: project.id,
    },
  });

  const credentialRef = await storeMailSecret(orgA.id, {
    provider: "google",
    accessToken: "fixture-access-token",
    refreshToken: "fixture-refresh-token",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scopes: ["https://mail.google.com/"],
    emailAddress: "joachim@example.com",
  });
  const account = await prisma.mailAccount.create({
    data: {
      organizationId: orgA.id,
      provider: "google",
      emailAddress: "joachim@example.com",
      status: "connected",
      credentialRef,
      capabilities: "[]",
    },
  });
  const leaked = await prisma.mailAccount.findFirst({ where: { id: account.id, organizationId: orgB.id } });
  assert(!leaked, "Account leak");

  const fixture = new FixtureMailProvider();
  fixture.files.set("a1", Buffer.from("Angebot rankPilot Partner 1200 Euro. Deadline bis Freitag."));
  fixture.messages.push({
    providerMessageId: "<hetzner-1@mail>",
    providerThreadId: "thread-hetzner",
    internetMessageId: "<hetzner-1@mail>",
    folder: "INBOX",
    from: { name: "Anna Hetzner", email: "anna@hetzner.com" },
    to: [{ email: "joachim@example.com" }],
    cc: [],
    bcc: [],
    subject: "Antwort zur Partnerschaft rankPilot Partner",
    textBody: "Können wir nächste Woche telefonieren?\n\nAm 1.9. schrieb Joachim:\n> altes Angebot komplett",
    htmlBody: "<p>Können wir nächste Woche telefonieren?</p><script>steal()</script>",
    receivedAt: new Date().toISOString(),
    isRead: false,
    direction: "inbound",
    headers: {},
    attachments: [{ id: "a1", filename: "angebot.txt", mimeType: "text/plain", size: 64 }],
    uid: 10,
    uidValidity: "1",
  });
  fixture.messages.push({
    providerMessageId: "<news-1@mail>",
    providerThreadId: "thread-news",
    internetMessageId: "<news-1@mail>",
    folder: "INBOX",
    from: { name: "News", email: "news@gmail.com" },
    to: [{ email: "joachim@example.com" }],
    cc: [],
    bcc: [],
    subject: "Newsletter",
    textBody: "Bitte abmelden",
    receivedAt: new Date().toISOString(),
    isRead: false,
    direction: "inbound",
    headers: { "list-unsubscribe": "<mailto:x@y>" },
    attachments: [],
    uid: 11,
    uidValidity: "1",
  });

  const synced = await startMailSync({ organizationId: orgA.id, accountId: account.id, provider: fixture });
  assert(synced.imported === 2, `Import ${synced.imported}`);
  const again = await startMailSync({ organizationId: orgA.id, accountId: account.id, provider: fixture });
  assert(again.imported === 0, "Incremental Sync darf nichts doppelt anlegen");

  const found = await searchMail({ organizationId: orgA.id, query: "Mails von Hetzner" });
  assert(found.length === 1 && found[0]?.organizationId === orgA.id, "Suche Hetzner");
  const foreign = await searchMail({ organizationId: orgB.id, query: "Hetzner" });
  assert(foreign.length === 0, "Tenant leak in der Suche");
  const summary = await summarizeInbox(orgA.id);
  assert(/Hetzner/.test(summary) && /neueste/i.test(summary), summary);
  assert(!/Newsletter braucht/.test(summary), summary);

  const message = await prisma.mailMessage.findFirst({ where: { organizationId: orgA.id, fromAddress: "anna@hetzner.com" } });
  assert(message?.classification === "REPLY_REQUIRED" || message?.classification === "IMPORTANT", message?.classification ?? "keine Klasse");
  assert(message?.normalizedText.includes("altes Angebot") === false, "Zitat darf nicht als neuer Text gelten");
  assert(message?.normalizedText.includes("steal") === false, "Script darf nicht in den Text");
  const thread = await prisma.mailThread.findFirst({ where: { id: message!.threadId, organizationId: orgA.id } });
  assert(thread?.projectId === project.id, "Projektverknüpfung");
  assert(thread?.companyId === company.id, "Firmenverknüpfung");
  assert(thread?.contactId, "Kontaktverknüpfung");

  const memory = await prisma.memoryEntry.findFirst({
    where: { organizationId: orgA.id, sourceType: "email", content: { contains: "telefonieren" } },
  });
  assert(memory?.sourceReference === message?.id, "Memory ohne Mailquelle");
  const attachment = await prisma.mailAttachment.findFirst({ where: { organizationId: orgA.id, filename: "angebot.txt" } });
  assert(attachment?.status === "indexed" && attachment.knowledgeSourceId, "Anhang nicht im Knowledge");

  const asked = await prepareMailDraft({
    organizationId: orgA.id,
    userRequest: "Antworte, dass wir nächste Woche telefonieren können.",
  });
  assert(asked.needsAccount && /(vorschlag|würde von|von welchem konto)/i.test(asked.reply), asked.reply);
  assert(!asked.approvalId, "Absenderfrage darf noch keine Freigabe öffnen");
  const draft = await prepareMailDraft({
    organizationId: orgA.id,
    userRequest: "ja",
  });
  assert(draft.ok && draft.approvalId, "Entwurf ohne Freigabe");
  assert(/Absender: joachim@example.com/i.test(draft.reply), draft.reply);
  assert(/nächste Woche telefonieren/i.test(draft.reply), draft.reply);
  const unsent = await deliverApprovedDraft({ organizationId: orgA.id, communicationId: draft.communicationId!, approved: false });
  assert(unsent.status === "WAITING_FOR_APPROVAL" && unsent.executed === false, "Versand ohne Freigabe");
  const communication = await prisma.communication.findFirst({ where: { id: draft.communicationId!, organizationId: orgA.id } });
  await prisma.communication.update({
    where: { id: communication!.id },
    data: { inReplyTo: "<hetzner-1@mail>", mailAccountId: account.id, mailThreadId: thread!.id },
  });
  const verified = await deliverApprovedDraft({
    organizationId: orgA.id,
    communicationId: communication!.id,
    approved: true,
    provider: fixture,
  });
  assert(verified.status === "VERIFIED", verified.reason);
  assert(fixture.sent[0]?.inReplyTo === "<hetzner-1@mail>", "Reply ohne In-Reply-To");
  const stored = await prisma.communication.findFirst({ where: { id: communication!.id } });
  assert(stored?.deliveryStatus === "VERIFIED", stored?.deliveryStatus ?? "");

  fixture.live = false;
  const offlineHits = await searchMail({ organizationId: orgA.id, query: "Partnerschaft" });
  assert(offlineHits.length > 0, "Offline-Suche");
  const offlineSend = await deliverApprovedDraft({
    organizationId: orgA.id,
    communicationId: communication!.id,
    approved: true,
    provider: fixture,
  });
  assert(offlineSend.status !== "VERIFIED", "Offline darf nicht als versendet gelten");

  const audit = await prisma.mailAuditEvent.findMany({ where: { organizationId: orgA.id } });
  assert(audit.some((item) => item.action === "SYNC"), "Audit SYNC");
  assert(audit.some((item) => item.action === "SEND_VERIFIED"), "Audit SEND_VERIFIED");
  assert(audit.every((item) => !/fixture-access-token|fixture-refresh-token|NOVA_MAIL_KEY/.test(item.detail ?? "")), "Token im Audit");
  const caps = await getMailCapabilityMap(orgB.id);
  assert(caps.MAIL_CONNECTION.state === "BLOCKED", "Verbindung ohne Konto muss blockiert sein");
  assert(caps.MAIL_CONNECTION.reason !== "PROVIDER_OAUTH_NOT_CONFIGURED", "Apple Mail darf nicht an fehlendem OAuth hängen");
  assert(
    caps.MAIL_CONNECTION.reason === "ACCOUNT_NOT_CONNECTED" ||
      caps.MAIL_CONNECTION.reason === "AUTOMATION_PERMISSION_REQUIRED" ||
      caps.MAIL_CONNECTION.reason === "PROVIDER_UNAVAILABLE",
    caps.MAIL_CONNECTION.reason ?? "",
  );

  const watch = await scanWatch(orgA.id);
  assert(Array.isArray(watch.newImportantMail), "Watch ohne Mail");
  const answer = await answerMail({ organizationId: orgB.id, userRequest: "Gibt es neue wichtige Mails?" });
  assert(/nicht verbunden|kein Mailkonto verbunden|keine neuen Mails/i.test(answer.reply), answer.reply);
  assert((await isRealConnectorEnabled(orgB.id, "mail")) === false, "Org B ohne Konto ist nicht real verbunden");

  console.log(JSON.stringify({ imported: synced.imported, capabilities: await getMailCapabilityMap(orgA.id), verified: verified.status }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
