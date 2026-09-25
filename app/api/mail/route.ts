import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { listMailAccounts } from "@/services/mail/accounts";
import { getMailCapabilityMap } from "@/services/mail/capabilities";
import { readMailAutomationState } from "@/services/mail/apple-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const tenant = await getCurrentTenant();
  const [accounts, capabilities, automation] = await Promise.all([
    listMailAccounts(tenant.organizationId),
    getMailCapabilityMap(tenant.organizationId),
    readMailAutomationState(),
  ]);
  return NextResponse.json({
    accounts: accounts.filter((account) => account.provider === "apple-mail"),
    capabilities,
    automation,
    provider: "apple-mail",
  });
}
