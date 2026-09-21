import { PrismaClient } from "@prisma/client";
import { runMaster } from "@/agents/master";
import { listActivities } from "@/services/archive";
import { searchMemory } from "@/services/retrieval";

const prisma = new PrismaClient();

async function main() {
  const organization = await prisma.organization.findUnique({ where: { slug: "joachim" } });
  if (!organization) {
    throw new Error("Seed fehlt. Bitte zuerst prisma migrate + seed ausführen.");
  }

  const isolation = await prisma.organization.upsert({
    where: { slug: "verify-isolation" },
    update: {},
    create: { name: "Verify Isolation", slug: "verify-isolation" },
  });

  const result = await runMaster({
    organizationId: organization.id,
    userRequest: "Finde 10 potenzielle Sponsoren und bereite die Ansprache vor.",
  });

  const job = await prisma.job.findFirst({
    where: { id: result.jobId, organizationId: organization.id },
    include: { steps: true, approvalRequests: true },
  });

  const companies = await prisma.company.findMany({ where: { organizationId: organization.id, isMock: true } });
  const contacts = await prisma.contact.findMany({ where: { organizationId: organization.id, isMock: true } });
  const drafts = await prisma.communication.findMany({
    where: { organizationId: organization.id, status: "prepared" },
  });
  const sent = await prisma.communication.count({
    where: { organizationId: organization.id, status: "sent" },
  });
  const executed = await prisma.activity.count({
    where: { organizationId: organization.id, status: "executed" },
  });
  const activities = await listActivities({ organizationId: organization.id });
  const memory = await searchMemory({ organizationId: organization.id, query: "sponsor", limit: 50 });
  const relations = await prisma.memoryRelation.count({ where: { organizationId: organization.id } });
  const leaked = await prisma.memoryEntry.count({
    where: { organizationId: isolation.id, title: { contains: "Nordlicht" } },
  });

  const checks = {
    jobCreated: Boolean(job),
    stepsCreated: (job?.steps.length ?? 0) >= 4,
    mockCompanies: companies.length >= 10,
    mockContacts: contacts.length >= 10,
    drafts: drafts.length >= 10,
    approval: (job?.approvalRequests.length ?? 0) >= 1,
    activities: activities.length >= 4,
    memory: memory.length >= 10,
    relations: relations >= 10,
    noSentMails: sent === 0,
    noFakeExecuted: executed === 0,
    tenantIsolation: leaked === 0,
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  console.log(JSON.stringify({ result, checks, failed: failed.map(([k]) => k) }, null, 2));

  if (failed.length > 0) {
    throw new Error(`Demo-Verifikation fehlgeschlagen: ${failed.map(([k]) => k).join(", ")}`);
  }

  console.log("NOVA Demo-Verifikation erfolgreich.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
