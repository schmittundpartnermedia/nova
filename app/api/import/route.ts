import { after, NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { getUploadImportStatus, importUploadedFiles, startUploadJob, type UploadFileInput } from "@/services/import/upload";
import { updateKnowledgeImport } from "@/services/knowledge/jobs";
import { updateJobStatus } from "@/services/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const url = new URL(request.url);
    const status = await getUploadImportStatus(tenant.organizationId, {
      jobId: url.searchParams.get("jobId") ?? undefined,
      importId: url.searchParams.get("importId") ?? undefined,
    });
    if (!status) return NextResponse.json({ ok: true, running: false, finished: false });
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const form = await request.formData();
    const files: UploadFileInput[] = [];
    for (const value of form.getAll("file")) {
      if (value && typeof value === "object" && "arrayBuffer" in value) {
        const blob = value as File;
        files.push({
          name: blob.name || "datei",
          mimeType: blob.type || undefined,
          bytes: Buffer.from(await blob.arrayBuffer()),
        });
      }
    }
    if (!files.length) {
      return NextResponse.json({ ok: false, error: "Bitte eine Datei wählen." }, { status: 400 });
    }

    const started = await startUploadJob({
      organizationId: tenant.organizationId,
      files,
    });

    after(async () => {
      try {
        const result = await importUploadedFiles({
          organizationId: tenant.organizationId,
          userRequest: "Dateien hochladen",
          jobId: started.job.id,
          importId: started.importId,
          files,
        });
        await updateJobStatus(tenant.organizationId, started.job.id, result.ok ? "completed" : "failed", {
          completedAt: new Date(),
        });
      } catch (error) {
        await updateJobStatus(tenant.organizationId, started.job.id, "failed", { completedAt: new Date() });
        await updateKnowledgeImport({
          organizationId: tenant.organizationId,
          id: started.importId,
          status: "FAILED",
          error: error instanceof Error ? error.message : "Import fehlgeschlagen",
          finished: true,
        });
      }
    });

    return NextResponse.json({
      ok: true,
      started: true,
      jobId: started.job.id,
      importId: started.importId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
