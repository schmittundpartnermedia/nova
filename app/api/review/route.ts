import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentTenant } from "@/services/tenant";
import { findActiveReview } from "@/services/review";
import { handleReviewUtterance } from "@/services/review/handle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const session = await findActiveReview(tenant.organizationId);
    return NextResponse.json({
      ok: true,
      active: Boolean(session),
      session: session
        ? {
            id: session.id,
            jobId: session.jobId,
            artifactId: session.artifactId,
            type: session.type,
            status: session.status,
            application: session.application,
            target: session.target,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review-Status fehlgeschlagen.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

const bodySchema = z.object({
  utterance: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const { utterance } = bodySchema.parse(await request.json());
    const result = await handleReviewUtterance({
      organizationId: tenant.organizationId,
      userRequest: utterance,
    });
    if (!result) {
      return NextResponse.json({
        ok: false,
        handled: false,
        message: "Keine aktive Prüfung für diese Aussage.",
      });
    }
    return NextResponse.json({ ok: true, handled: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review-Steuerung fehlgeschlagen.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
