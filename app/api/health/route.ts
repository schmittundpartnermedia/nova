import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { getAIProviderById, listAIProviders, resolveAIProvider } from "@/providers/ai/registry";
import { bootstrapAgents, listAgents } from "@/agents/bootstrap";
import { prisma } from "@/lib/prisma";
import { publicErrorMessage } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    bootstrapAgents();
    const tenant = await getCurrentTenant();
    const { provider, decision } = await resolveAIProvider(tenant.organizationId, "master");
    const [activeHealth, openaiHealth] = await Promise.all([
      provider.healthCheck(),
      getAIProviderById("openai").healthCheck(),
    ]);
    const orgCount = await prisma.organization.count();
    const member = await prisma.organizationMember.findFirst({
      where: { organizationId: tenant.organizationId, userId: tenant.userId },
    });

    return NextResponse.json({
      ok: openaiHealth.ok && !decision.fallback,
      name: "NOVA",
      tenant,
      memberAssigned: Boolean(member),
      organizationsInDatabase: orgCount,
      ai: {
        requested: decision.requestedProviderId,
        active: provider.id,
        model: decision.model,
        fallback: decision.fallback,
        providerMode: decision.fallback ? "fallback" : provider.id,
        decision,
        health: activeHealth,
        openai: openaiHealth,
        available: listAIProviders().map((item) => item.id),
      },
      agents: listAgents().map((agent) => ({
        id: agent.definition.id,
        implemented: agent.definition.implemented,
      })),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicErrorMessage(error) }, { status: 500 });
  }
}
