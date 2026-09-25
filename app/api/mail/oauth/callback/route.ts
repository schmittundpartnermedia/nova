import { NextResponse } from "next/server";
import { completeMailOAuth } from "@/services/mail/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  if (providerError || !code || !state) {
    return NextResponse.redirect(new URL("/?mail=blocked", url.origin));
  }
  const result = await completeMailOAuth({ code, state });
  const target = new URL(result.ok ? "/?mail=connected" : "/?mail=failed", url.origin);
  return NextResponse.redirect(target);
}
