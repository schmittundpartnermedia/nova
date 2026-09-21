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
    { role: "master", provider: "openai", model: "gpt-4o" },
    { role: "simple", provider: "openai", model: "gpt-4o-mini" },
    { role: "sensitive", provider: "openai", model: "gpt-4o-mini" },
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
        config: JSON.stringify({
          note: "V1 verwendet OpenAI über AiProviderConfig. Der API-Key liegt nur in der Environment Variable OPENAI_API_KEY.",
        }),
      },
    });
  }

  const connectors = [
    { type: "mail", provider: "mock", enabled: false },
    { type: "calendar", provider: "mock", enabled: false },
    { type: "search", provider: "mock", enabled: false },
    { type: "search", provider: "openai", enabled: true },
    { type: "storage", provider: "mock", enabled: false },
    { type: "tasks", provider: "mock", enabled: false },
    { type: "contacts", provider: "mock", enabled: false },
    { type: "browser", provider: "mock", enabled: false },
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
      update: { enabled: connector.enabled },
      create: {
        organizationId: organization.id,
        type: connector.type,
        provider: connector.provider,
        enabled: connector.enabled,
        config: JSON.stringify({
          note:
            connector.provider === "openai"
              ? "Websuche über OpenAI Web Search. Der API-Key liegt nur in OPENAI_API_KEY."
              : "Nur Interface/Mock. Keine echte externe Verbindung.",
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
