import { PrismaClient } from "@prisma/client";
import { bootstrapAgents, getAgent } from "@/agents/bootstrap";
import { runOpsUnitTests } from "@/lib/ops/unit-tests";
import { runComputerUnitTests } from "@/lib/computer/unit-tests";
import { LocalCalendarProvider } from "@/connectors/calendar/local";
import { MockMailProvider } from "@/connectors/mail/mock";
import { scanWatch } from "@/agents/watch";
import { standingApprovalAllows, createStandingPolicy, consumeStandingApproval } from "@/services/approvals";
import { isRealConnectorEnabled } from "@/connectors/registry";
import { smtpConfigured } from "@/connectors/mail/smtp";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const units = runOpsUnitTests();
  if (units.length) throw new Error(units.join("; "));
  const computerUnits = runComputerUnitTests();
  if (computerUnits.length) throw new Error(computerUnits.join("; "));

  bootstrapAgents();
  assert(getAgent("calendar")?.definition.implemented === true, "Calendar Agent nicht implementiert");
  assert(getAgent("watch")?.definition.implemented === true, "Watch Agent nicht implementiert");

  const organization = await prisma.organization.upsert({
    where: { slug: "ops-verify" },
    update: { name: "Ops Verify" },
    create: { name: "Ops Verify", slug: "ops-verify" },
  });
  await prisma.meeting.deleteMany({ where: { organizationId: organization.id } });
  await prisma.task.deleteMany({ where: { organizationId: organization.id } });
  await prisma.communication.deleteMany({ where: { organizationId: organization.id } });
  await prisma.approvalRequest.deleteMany({ where: { organizationId: organization.id } });
  await prisma.approvalPolicy.deleteMany({ where: { organizationId: organization.id } });

  const calendar = new LocalCalendarProvider();
  const created = await calendar.create(organization.id, {
    title: "Hetzner Review",
    startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
  assert(created.ok && created.executed, created.reason);
  const listed = (await calendar.list(organization.id, new Date(), new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))) as Array<{
    title: string;
  }>;
  assert(listed.some((item) => item.title === "Hetzner Review"), "Termin nicht listbar");
  const calendarRun = await getAgent("calendar")!.run(
    { userRequest: "Welche Termine stehen an?" },
    {
      organizationId: organization.id,
      jobId: "ops-verify-calendar",
      userRequest: "Welche Termine stehen an?",
      goal: "Termine listen",
    },
  );
  assert(calendarRun.ok && /Hetzner Review/i.test(calendarRun.summary), calendarRun.summary);
  assert(await isRealConnectorEnabled(organization.id, "calendar"), "Lokaler Kalender muss real gelten");

  await prisma.task.create({
    data: {
      organizationId: organization.id,
      title: "Überfälliger Follow-up",
      status: "open",
      dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });
  const scan = await scanWatch(organization.id);
  assert(scan.overdueTasks.some((item) => item.title.includes("Follow-up")), "Watch sieht überfällige Aufgabe nicht");

  const mail = new MockMailProvider();
  const send = await mail.send({
    organizationId: organization.id,
    to: "clara@example.com",
    subject: "Test",
    body: "Nein",
  });
  assert(send.executed === false && send.mock === true, "Mock darf keinen Versand behaupten");
  assert(
    (await isRealConnectorEnabled(organization.id, "mail")) === smtpConfigured(),
    "Mail gilt nur dann als real, wenn SMTP_HOST und SMTP_FROM gesetzt sind",
  );

  await createStandingPolicy({
    organizationId: organization.id,
    name: "Alltagsklicks",
    actionType: "macos.ui.click",
    limits: { maxPerDay: 20 },
  });
  const standing = await standingApprovalAllows({
    organizationId: organization.id,
    actionType: "macos.ui.click",
  });
  assert(standing.allowed, standing.reason);
  const missing = await standingApprovalAllows({
    organizationId: organization.id,
    actionType: "mail.send.batch",
  });
  assert(missing.allowed === false, "Ohne Policy darf Mail nicht durchwinken");

  await createStandingPolicy({
    organizationId: organization.id,
    name: "Alltagsmails",
    actionType: "mail.send.batch",
    limits: { maxPerDay: 1 },
  });
  const firstMail = await consumeStandingApproval({
    organizationId: organization.id,
    actionType: "mail.send.batch",
    description: "Testverbrauch",
  });
  assert(firstMail.allowed, firstMail.reason);
  const secondMail = await consumeStandingApproval({
    organizationId: organization.id,
    actionType: "mail.send.batch",
    description: "Testverbrauch 2",
  });
  assert(secondMail.allowed === false, "Tageslimit der Dauerfreigabe muss greifen");

  const other = await prisma.organization.upsert({
    where: { slug: "ops-isolation" },
    update: {},
    create: { name: "Ops Isolation", slug: "ops-isolation" },
  });
  const leaked = await calendar.list(other.id, new Date(), new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
  assert(Array.isArray(leaked) && leaked.length === 0, "Kalender leakte über Tenant");

  console.log(
    JSON.stringify(
      {
        ok: true,
        calendarExecuted: created.executed,
        overdue: scan.overdueTasks.length,
        mailExecuted: send.executed,
        standing: standing.allowed,
      },
      null,
      2,
    ),
  );
  console.log("NOVA Ops-Verifikation erfolgreich.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
