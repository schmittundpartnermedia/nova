import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { listMailAccounts } from "@/services/mail/accounts";
import { getMailCapabilityMap } from "@/services/mail/capabilities";
import { oauthConfigured } from "@/services/mail/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const tenant = await getCurrentTenant();
  const [accounts, capabilities] = await Promise.all([
    listMailAccounts(tenant.organizationId),
    getMailCapabilityMap(tenant.organizationId),
  ]);
  return NextResponse.json({
    accounts,
    capabilities,
    providers: {
      google: { configured: oauthConfigured("google") },
      microsoft: { configured: oauthConfigured("microsoft") },
    },
  });
}
