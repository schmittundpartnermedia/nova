import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { connectAppleMail } from "@/services/mail/apple-connect";
import { getMailCapabilityMap } from "@/services/mail/capabilities";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const tenant = await getCurrentTenant();
  const result = await connectAppleMail(tenant.organizationId);
  const capabilities = await getMailCapabilityMap(tenant.organizationId);
  return NextResponse.json({ ...result, capabilities });
}
