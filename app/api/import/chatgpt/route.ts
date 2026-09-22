import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentTenant } from "@/services/tenant";
import { importChatGPTExport } from "@/services/import/chatgpt";
import { createJob, updateJobStatus } from "@/services/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const jsonSchema = z.object({
  path: z.string().min(1).optional(),
  conversations: z.array(z.record(z.string(), z.unknown())).optional(),
  resumeImportId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const contentType = request.headers.get("content-type") ?? "";
    let zipBytes: Buffer | undefined;
    let filePath: string | undefined;
    let conversations: unknown[] | undefined;
    let resumeImportId: string | undefined;
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      resumeImportId = typeof form.get("resumeImportId") === "string" ? String(form.get("resumeImportId")) : undefined;
      if (file && typeof file === "object" && "arrayBuffer" in file) {
        zipBytes = Buffer.from(await file.arrayBuffer());
      }
      const pathValue = form.get("path");
      if (typeof pathValue === "string") filePath = pathValue;
    } else {
      const json = jsonSchema.parse(await request.json());
      filePath = json.path;
      conversations = json.conversations;
      resumeImportId = json.resumeImportId;
    }
    if (!zipBytes && !filePath && !conversations) {
      return NextResponse.json({ ok: false, error: "Bitte eine ChatGPT-Export-ZIP oder conversations.json wählen." }, { status: 400 });
    }
    const job = await createJob({
      organizationId: tenant.organizationId,
      userRequest: "Importiere ChatGPT-Verlauf",
      goal: "ChatGPT Export importieren",
    });
    await updateJobStatus(tenant.organizationId, job.id, "running", { startedAt: new Date() });
    const result = await importChatGPTExport({
      organizationId: tenant.organizationId,
      userRequest: "Importiere ChatGPT-Verlauf",
      jobId: job.id,
      zipBytes,
      filePath,
      conversations,
      resumeImportId,
    });
    await updateJobStatus(tenant.organizationId, job.id, result.cancelled ? "cancelled" : result.ok ? "completed" : "failed", {
      completedAt: new Date(),
    });
    return NextResponse.json({ jobId: job.id, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
