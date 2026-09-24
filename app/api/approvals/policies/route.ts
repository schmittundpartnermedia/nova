import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentTenant } from "@/services/tenant";
import {
  createStandingPolicy,
  listStandingPolicies,
  revokeStandingPolicy,
  standingActionLabel,
} from "@/services/approvals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createSchema = z.object({
  actionType: z.enum(["mail.send.batch", "macos.ui.click"]),
  name: z.string().trim().min(1).max(80).optional(),
  maxPerDay: z.number().int().positive().max(200).optional(),
});

const revokeSchema = z.object({
  policyId: z.string().min(1),
});

function safeJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const policies = await listStandingPolicies(tenant.organizationId);
    return NextResponse.json({
      ok: true,
      policies: policies.map((item) => ({
        id: item.id,
        name: item.name,
        actionType: item.actionType,
        label: standingActionLabel(item.actionType),
        limits: safeJson(item.limits),
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const body = createSchema.parse(await request.json());
    const policy = await createStandingPolicy({
      organizationId: tenant.organizationId,
      name: body.name ?? standingActionLabel(body.actionType),
      actionType: body.actionType,
      limits: { maxPerDay: body.maxPerDay ?? (body.actionType === "mail.send.batch" ? 20 : 40) },
    });
    return NextResponse.json({
      ok: true,
      policy: {
        id: policy.id,
        name: policy.name,
        actionType: policy.actionType,
        label: standingActionLabel(policy.actionType),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const url = new URL(request.url);
    const fromQuery = url.searchParams.get("policyId");
    const body = fromQuery ? { policyId: fromQuery } : revokeSchema.parse(await request.json());
    await revokeStandingPolicy({ organizationId: tenant.organizationId, policyId: body.policyId });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
