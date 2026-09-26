import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentTenant } from "@/services/tenant";
import {
  decideApproval,
  createStandingPolicy,
  isStandingActionType,
  standingActionLabel,
} from "@/services/approvals";
import { executeDecidedApproval } from "@/services/approvals/fulfill";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  approvalId: z.string(),
  decision: z.enum(["approved", "rejected"]),
  standing: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { approvalId, decision, standing } = bodySchema.parse(json);
    const tenant = await getCurrentTenant();
    const approval = await decideApproval({
      organizationId: tenant.organizationId,
      approvalId,
      status: decision,
    });

    if (decision === "approved" && standing && isStandingActionType(approval.actionType)) {
      await createStandingPolicy({
        organizationId: tenant.organizationId,
        name: standingActionLabel(approval.actionType),
        actionType: approval.actionType,
        limits: { maxPerDay: approval.actionType === "mail.send.batch" ? 20 : 40 },
      });
    }

    const result = await executeDecidedApproval({
      organizationId: tenant.organizationId,
      approval,
      decision,
    });

    return NextResponse.json({
      ok: true,
      executed: result.executed,
      sent: result.sent,
      message: result.executed && standing ? `${result.message} Dauerfreigabe ist aktiv.` : result.message,
      standing: Boolean(standing && isStandingActionType(approval.actionType)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
