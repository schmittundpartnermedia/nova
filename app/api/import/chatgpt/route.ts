import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentTenant } from "@/services/tenant";
import { assertChatGPTExportFile, getChatGPTImportStatus, importChatGPTExport } from "@/services/import/chatgpt";
import { createKnowledgeImport, updateKnowledgeImport } from "@/services/knowledge/jobs";
import { createJob, updateJobStatus } from "@/services/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const jsonSchema = z.object({
  path: z.string().min(1).optional(),
  conversations: z.array(z.record(z.string(), z.unknown())).optional(),
  resumeImportId: z.string().optional(),
});

function writeUpload(jobId: string, bytes: Buffer): string {
  const dir = path.join(os.tmpdir(), "nova-chatgpt-uploads");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${jobId}.zip`);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function cleanupUpload(filePath?: string) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    // temp file already gone
  }
}

function friendlyStartError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unbekannter Fehler";
  if (/kein gültiges zip|kein chatgpt-export|conversations\.json|kein gültiges json/i.test(message)) {
    return "Das ist kein gültiger ChatGPT-Export. Bitte die originale ZIP-Datei wählen, die du von OpenAI heruntergeladen hast.";
  }
  return message;
}

export async function GET(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const url = new URL(request.url);
    const status = await getChatGPTImportStatus(tenant.organizationId, {
      jobId: url.searchParams.get("jobId") ?? undefined,
      importId: url.searchParams.get("importId") ?? undefined,
    });
    if (!status) {
      return NextResponse.json({ ok: true, running: false, finished: false });
    }
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  let uploadPath: string | undefined;
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
      return NextResponse.json({ ok: false, error: "Bitte eine ChatGPT-Export-ZIP wählen." }, { status: 400 });
    }

    if (zipBytes || filePath) {
      assertChatGPTExportFile({ zipBytes, filePath });
    }

    const job = await createJob({
      organizationId: tenant.organizationId,
      userRequest: "Importiere ChatGPT-Verlauf",
      goal: "ChatGPT Export importieren",
    });
    await updateJobStatus(tenant.organizationId, job.id, "running", { startedAt: new Date() });
    const knowledgeImport = resumeImportId
      ? null
      : await createKnowledgeImport({
          organizationId: tenant.organizationId,
          userRequest: "Importiere ChatGPT-Verlauf",
          jobId: job.id,
          rootPath: filePath,
          kind: "chatgpt",
          metadata: { source: "CHATGPT" },
        });
    const importId = resumeImportId ?? knowledgeImport?.id;
    if (zipBytes) {
      uploadPath = writeUpload(job.id, zipBytes);
    }

    after(async () => {
      try {
        const result = await importChatGPTExport({
          organizationId: tenant.organizationId,
          userRequest: "Importiere ChatGPT-Verlauf",
          jobId: job.id,
          filePath: uploadPath ?? filePath,
          conversations,
          resumeImportId: importId,
        });
        await updateJobStatus(tenant.organizationId, job.id, result.cancelled ? "cancelled" : result.ok ? "completed" : "failed", {
          completedAt: new Date(),
        });
      } catch (error) {
        await updateJobStatus(tenant.organizationId, job.id, "failed", { completedAt: new Date() });
        const message = error instanceof Error ? error.message : "Import fehlgeschlagen";
        if (importId) {
          await updateKnowledgeImport({
            organizationId: tenant.organizationId,
            id: importId,
            status: "FAILED",
            error: message,
            finished: true,
          });
        }
      } finally {
        cleanupUpload(uploadPath);
      }
    });

    return NextResponse.json({
      ok: true,
      started: true,
      jobId: job.id,
      importId,
    });
  } catch (error) {
    cleanupUpload(uploadPath);
    return NextResponse.json({ ok: false, error: friendlyStartError(error) }, { status: 400 });
  }
}
