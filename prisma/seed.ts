import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: "joachim" },
    update: { name: "Joachim" },
    create: {
      name: "Joachim",
      slug: "joachim",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "joachim@local" },
    update: { name: "Joachim" },
    create: {
      email: "joachim@local",
      name: "Joachim",
    },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    update: { role: "owner" },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: "owner",
    },
  });

  const project = await prisma.project.findFirst({
    where: { organizationId: organization.id, name: "Projekt X" },
  });

  if (!project) {
    await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Projekt X",
        description: "Aktives Vorhaben, für das Sponsoren gewonnen werden sollen.",
        status: "active",
      },
    });
  }

  const aiRoles = [
    { role: "master", provider: "mock", model: "mock-master" },
    { role: "simple", provider: "mock", model: "mock-simple" },
    { role: "sensitive", provider: "mock", model: "mock-local" },
    { role: "fallback", provider: "mock", model: "mock-fallback" },
  ] as const;

  for (const entry of aiRoles) {
    await prisma.aiProviderConfig.upsert({
      where: {
        organizationId_role: {
          organizationId: organization.id,
          role: entry.role,
        },
      },
      update: {
        provider: entry.provider,
        model: entry.model,
        enabled: true,
      },
      create: {
        organizationId: organization.id,
        provider: entry.provider,
        role: entry.role,
        model: entry.model,
        enabled: true,
        config: JSON.stringify({ note: "V1 verwendet MockAIProvider. Kein echter KI-Anbieter verbunden." }),
      },
    });
  }

  const connectors = [
    { type: "mail", provider: "mock" },
    { type: "calendar", provider: "mock" },
    { type: "search", provider: "mock" },
    { type: "storage", provider: "mock" },
    { type: "tasks", provider: "mock" },
    { type: "contacts", provider: "mock" },
    { type: "browser", provider: "mock" },
  ] as const;

  for (const connector of connectors) {
    await prisma.connectorConfig.upsert({
      where: {
        organizationId_type_provider: {
          organizationId: organization.id,
          type: connector.type,
          provider: connector.provider,
        },
      },
      update: { enabled: false },
      create: {
        organizationId: organization.id,
        type: connector.type,
        provider: connector.provider,
        enabled: false,
        config: JSON.stringify({
          note: "Nur Interface/Mock. Keine echte externe Verbindung.",
        }),
      },
    });
  }

  console.log("NOVA seed abgeschlossen.");
  console.log(`Organization: ${organization.name} (${organization.id})`);
  console.log(`User: ${user.name} / ${user.email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
