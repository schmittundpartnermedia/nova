import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { listWorkspaceManifest, workspaceStatus } from "@/services/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const status = workspaceStatus();
    const manifest = await listWorkspaceManifest(tenant.organizationId);
    return NextResponse.json({
      ok: status.availability === "AVAILABLE",
      availability: status.availability,
      path: status.resolvedPath,
      volumeName: status.volumeName,
      source: status.source,
      writable: status.writable,
      message: status.message,
      entries: manifest.entries.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace-Status fehlgeschlagen.";
    return NextResponse.json({ ok: false, availability: "ERROR", message }, { status: 500 });
  }
}
