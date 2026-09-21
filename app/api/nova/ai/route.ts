import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const tenant = await getCurrentTenant();
  const catalog = await prisma.aiProviderConfig.findMany({
    where: { organizationId: tenant.organizationId },
  });
  return NextResponse.json({
    ok: true,
    organizationId: tenant.organizationId,
    configs: catalog,
    note: "AI-Konfiguration ist organizationsbezogen. Memory bleibt davon unabhängig.",
  });
}
