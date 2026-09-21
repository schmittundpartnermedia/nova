import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { listAIProviders, resolveAIProvider } from "@/providers/ai/registry";
import { bootstrapAgents, listAgents } from "@/agents/bootstrap";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    bootstrapAgents();
    const tenant = await getCurrentTenant();
    const { provider, decision } = await resolveAIProvider(tenant.organizationId, "master");
    const health = await provider.healthCheck();
    const orgCount = await prisma.organization.count();
    const member = await prisma.organizationMember.findFirst({
      where: { organizationId: tenant.organizationId, userId: tenant.userId },
    });

    return NextResponse.json({
      ok: true,
      name: "NOVA",
      tenant,
      memberAssigned: Boolean(member),
      organizationsInDatabase: orgCount,
      ai: {
        active: provider.id,
        decision,
        health,
        available: listAIProviders().map((item) => item.id),
      },
      agents: listAgents().map((agent) => ({
        id: agent.definition.id,
        implemented: agent.definition.implemented,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
