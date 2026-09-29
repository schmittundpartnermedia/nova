import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { resolveHead } from "@/providers/ai/head";
import { prisma } from "@/lib/prisma";
import { publicErrorMessage } from "@/lib/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const { provider, model } = await resolveHead(tenant.organizationId);
    const health = await provider.healthCheck();
    const orgCount = await prisma.organization.count();
    const member = await prisma.organizationMember.findFirst({
      where: { organizationId: tenant.organizationId, userId: tenant.userId },
    });

    return NextResponse.json({
      ok: health.ok,
      name: "NOVA",
      tenant,
      memberAssigned: Boolean(member),
      organizationsInDatabase: orgCount,
      ai: {
        provider: provider.id,
        model,
        health,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicErrorMessage(error) }, { status: 500 });
  }
}
