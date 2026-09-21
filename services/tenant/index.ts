import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import type { TenantContext } from "@/types";

export async function getCurrentTenant(): Promise<TenantContext> {
  const env = getEnv();
  const organization = await prisma.organization.findUnique({
    where: { slug: env.NOVA_ORG_SLUG },
  });

  if (!organization) {
    throw new Error(
      `Organization '${env.NOVA_ORG_SLUG}' nicht gefunden. Bitte 'npx prisma db seed' ausführen.`,
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: env.NOVA_USER_EMAIL },
  });

  if (!user) {
    throw new Error(`User '${env.NOVA_USER_EMAIL}' nicht gefunden. Bitte seed ausführen.`);
  }

  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
  });

  if (!membership) {
    throw new Error("Benutzer ist keiner Organization zugeordnet.");
  }

  return {
    organizationId: organization.id,
    organizationSlug: organization.slug,
    organizationName: organization.name,
    userId: user.id,
    userName: user.name,
    role: membership.role as TenantContext["role"],
  };
}

export function assertOrganizationId(organizationId: string): void {
  if (!organizationId || organizationId.trim().length === 0) {
    throw new Error("organizationId ist Pflicht. Alle Business-Daten sind tenant-aware.");
  }
}
