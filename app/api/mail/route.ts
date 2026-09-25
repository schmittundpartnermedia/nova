import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentTenant } from "@/services/tenant";
import { connectMailAccount, listMailAccounts } from "@/services/mail/accounts";
import { getMailCapabilityMap } from "@/services/mail/capabilities";
import { probeImap } from "@/connectors/mail/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const connectSchema = z.object({
  emailAddress: z.string().email(),
  password: z.string().min(1),
  displayName: z.string().optional(),
  host: z.string().optional(),
});

export async function GET() {
  const tenant = await getCurrentTenant();
  const [accounts, capabilities] = await Promise.all([
    listMailAccounts(tenant.organizationId),
    getMailCapabilityMap(tenant.organizationId),
  ]);
  return NextResponse.json({ accounts, capabilities });
}

export async function POST(request: Request) {
  const tenant = await getCurrentTenant();
  const body = connectSchema.parse(await request.json());
  const result = await connectMailAccount({
    organizationId: tenant.organizationId,
    emailAddress: body.emailAddress,
    displayName: body.displayName,
    password: body.password,
    host: body.host,
    probe: probeImap,
  });
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
  return NextResponse.json({ ok: true, account: result.account });
}
