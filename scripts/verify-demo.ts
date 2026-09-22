import { PrismaClient } from "@prisma/client";
import { runMaster } from "@/agents/master";
import { needsSpecialistWork } from "@/agents/master/intent";
import { searchMemory } from "@/services/retrieval";

const prisma = new PrismaClient();

async function main() {
  if (needsSpecialistWork("Hallo NOVA, wie ist der Stand?")) {
    throw new Error("Gespräch darf keinen Spezialisten-Planer brauchen.");
  }
  if (needsSpecialistWork("Was hatten wir zu ELEVUM beschlossen?")) {
    throw new Error("Archiv-Rückfrage darf direkt beantwortet werden.");
  }
  if (!needsSpecialistWork("Finde aktuelle Unternehmen, die als Sponsor passen.")) {
    throw new Error("Aktuelle Recherche muss den Spezialisten-Pfad nutzen.");
  }
  if (!needsSpecialistWork("Merk dir: Hetzner startet mit drei Monaten Pilot.")) {
    throw new Error("Merk-dir muss Memory schreiben.");
  }

  const organization = await prisma.organization.findUnique({ where: { slug: "joachim" } });
  if (!organization) {
    throw new Error("Seed fehlt. Bitte zuerst prisma migrate + seed ausführen.");
  }

  const isolation = await prisma.organization.upsert({
    where: { slug: "verify-isolation" },
    update: {},
    create: { name: "Verify Isolation", slug: "verify-isolation" },
  });

  const leakedBefore = await prisma.memoryEntry.count({
    where: { organizationId: isolation.id },
  });

  const result = await runMaster({
    organizationId: organization.id,
    userRequest: "Finde aktuelle Unternehmen, die als Sponsor passen.",
  });

  const job = await prisma.job.findFirst({
    where: { id: result.jobId, organizationId: organization.id },
    include: { steps: true, approvalRequests: true },
  });

  const sent = await prisma.communication.count({
    where: { organizationId: organization.id, status: "sent" },
  });
  const executed = await prisma.activity.count({
    where: { organizationId: organization.id, status: "executed" },
  });
  const inventedReal = await prisma.company.count({
    where: {
      organizationId: organization.id,
      isMock: false,
      notes: { contains: "echte Recherche" },
    },
  });
  const leaked = await prisma.memoryEntry.count({
    where: { organizationId: isolation.id },
  });
  const memoryScoped = await searchMemory({
    organizationId: organization.id,
    query: "sponsor",
    limit: 5,
  });
  const cross = memoryScoped.filter((item) => item.organizationId !== organization.id);

  const reply = result.reply.toLowerCase();
  const honestResearch =
    reply.includes("search") ||
    reply.includes("connector") ||
    reply.includes("recherche") ||
    reply.includes("quelle") ||
    reply.includes("nicht zuverlässig") ||
    reply.includes("nicht verbunden") ||
    /https?:\/\//i.test(result.reply);

  const checks = {
    jobCreated: Boolean(job),
    openaiOrMockVisible: result.providerMode === "openai" || result.providerMode === "mock" || result.providerMode === "error",
    noSentMails: sent === 0,
    noFakeExecuted: executed === 0,
    noInventedRealResearch: inventedReal === 0,
    honestResearch,
    tenantIsolation: leaked === leakedBefore && cross.length === 0,
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  console.log(JSON.stringify({ result: { ...result, reply: result.reply.slice(0, 400) }, checks, failed: failed.map(([k]) => k) }, null, 2));

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
