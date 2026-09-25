import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { beginMailOAuth } from "@/services/mail/oauth";
import type { MailOAuthProvider } from "@/services/mail/credentials";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isProvider(value: string | null): value is MailOAuthProvider {
  return value === "google" || value === "microsoft";
}

export async function GET(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider");
  if (!isProvider(provider)) return NextResponse.json({ ok: false, reason: "Unbekannter Anbieter." }, { status: 400 });
  const tenant = await getCurrentTenant();
  const started = await beginMailOAuth(tenant.organizationId, provider);
  if (!started.ok) {
    return NextResponse.json({ ok: false, reason: started.reason, code: "BLOCKED_BY_PROVIDER_CONFIGURATION" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, url: started.url });
}
