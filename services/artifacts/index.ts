import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { directoryForArtifact } from "@/lib/workspace/layout";
import { artifactFileName } from "@/lib/workspace/naming";
import { probeWorkspaceRoot } from "@/lib/workspace/root";
import { writeWorkspaceFile } from "@/services/workspace";
import { importKnowledgePaths } from "@/services/knowledge";
import { createSource, upsertDurableMemory } from "@/services/memory";
import { recordActivity } from "@/services/archive";
import { createReviewSession } from "@/services/review";
import { setJobExecution } from "@/services/jobs";
import { enqueueWorkItem } from "@/services/worker/queue";
import type { ArtifactStatus, ArtifactType, ReviewType } from "@/types/workspace";

const REVIEW_TYPE_OF: Partial<Record<ArtifactType, ReviewType>> = {
  RESEARCH_REPORT: "DOCUMENT",
  BRIEFING: "DOCUMENT",
  ANALYSIS: "DOCUMENT",
  DOCUMENT: "DOCUMENT",
  STORYBOARD: "DOCUMENT",
  LEAD_LIST: "DOCUMENT",
  MAIL_DRAFT: "MAIL_DRAFT",
  CODING_BRIEF: "CODING_RESULT",
  VIDEO_CLIP: "VIDEO",
  IMAGE: "IMAGE",
  AUDIO: "AUDIO",
  EXPORT: "FILE",
  OTHER: "FILE",
};

export type FiledArtifact = {
  ok: boolean;
  message: string;
  artifactId?: string;
  relativePath?: string;
  absolutePath?: string;
  reviewSessionId?: string;
  knowledgeSourceId?: string;
  memoryEntryId?: string;
  windowOpened?: boolean;
};

async function nextVersion(input: { organizationId: string; type: ArtifactType; title: string }) {
  const latest = await prisma.artifact.findFirst({
    where: { organizationId: input.organizationId, type: input.type, title: input.title },
    orderBy: { version: "desc" },
  });
  return {
    version: (latest?.version ?? 0) + 1,
    versionGroupId: latest?.versionGroupId ?? randomUUID(),
    previousId: latest?.id ?? null,
  };
}

export async function fileArtifact(input: {
  organizationId: string;
  jobId?: string;
  projectId?: string;
  type: ArtifactType;
  title: string;
  description?: string;
  body?: string;
  extension?: string;
  source: string;
  externalReference?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
  openReview?: boolean;
  approvalRequestId?: string;
  resumeStep?: string;
}): Promise<FiledArtifact> {
  assertOrganizationId(input.organizationId);
  const root = probeWorkspaceRoot();
  if (root.availability !== "AVAILABLE" || !root.resolvedPath) {
    return { ok: false, message: root.message };
  }

  const organization = await prisma.organization.findFirst({ where: { id: input.organizationId } });
  if (!organization) return { ok: false, message: "Organization fehlt. Artefakt wurde nicht abgelegt." };
  const project = input.projectId
    ? await prisma.project.findFirst({ where: { id: input.projectId, organizationId: input.organizationId } })
    : null;
  const versioning = await nextVersion({
    organizationId: input.organizationId,
    type: input.type,
    title: input.title,
  });
  const relativeDir = directoryForArtifact({
    type: input.type,
    organizationSlug: organization.slug,
    projectSlug: project?.name,
  });
  const fileName = artifactFileName({
    date: new Date(),
    organizationSlug: organization.slug,
    title: input.title,
    version: versioning.version,
    extension: input.extension ?? "md",
  });
  const hasBody = typeof input.body === "string";
  let relativePath: string | undefined;
  let absolutePath: string | undefined;
  if (hasBody) {
    const written = await writeWorkspaceFile({
      organizationId: input.organizationId,
      relativeDir,
      fileName,
      body: input.body ?? "",
      title: input.title,
      projectId: project?.id,
      jobId: input.jobId,
      version: versioning.version,
      source: input.source,
    });
    if (!written.ok) return { ok: false, message: written.message };
    relativePath = written.value.relativePath;
    absolutePath = written.value.absolutePath;
  } else if (!input.externalReference) {
    return { ok: false, message: "Artefakt ohne Datei und ohne externe Referenz wurde nicht angelegt." };
  }

  const artifact = await prisma.artifact.create({
    data: {
      organizationId: input.organizationId,
      projectId: project?.id,
      jobId: input.jobId,
      type: input.type,
      title: input.title,
      description: input.description,
      storagePath: relativePath,
      externalReference: input.externalReference,
      mimeType: input.mimeType ?? (hasBody ? "text/markdown" : undefined),
      status: input.openReview ? "READY_FOR_REVIEW" : "DRAFT",
      source: input.source,
      version: versioning.version,
      versionGroupId: versioning.versionGroupId,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
  if (versioning.previousId) {
    await prisma.artifact.updateMany({
      where: { id: versioning.previousId, organizationId: input.organizationId, status: { not: "FINAL" } },
      data: { status: "SUPERSEDED" satisfies ArtifactStatus },
    });
  }
  if (relativePath) {
    await prisma.workspaceEntry.updateMany({
      where: { organizationId: input.organizationId, relativePath },
      data: { artifactId: artifact.id, jobId: input.jobId },
    });
  }

  let knowledgeSourceId: string | undefined;
  let memoryEntryId: string | undefined;
  const notes: string[] = [];
  if (absolutePath) {
    try {
      const imported = await importKnowledgePaths({
        organizationId: input.organizationId,
        userRequest: `Indexiere das NOVA-Artefakt ${artifact.title}`,
        paths: [absolutePath],
        jobId: input.jobId,
        projectId: project?.id,
      });
      knowledgeSourceId = imported.sourceIds[0];
      if (!imported.ok || imported.filesSuccess < 1) {
        notes.push(`Knowledge-Index: ${imported.summary}`);
      }
    } catch (error) {
      notes.push(`Knowledge-Index fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannt"}`);
    }
    const source = await createSource({
      organizationId: input.organizationId,
      type: "document",
      reference: artifact.id,
      url: absolutePath,
      title: artifact.title,
      label: "NOVA Artifact",
      jobId: input.jobId,
      metadata: { relativePath, version: versioning.version, source: input.source },
    });
    const memory = await upsertDurableMemory({
      organizationId: input.organizationId,
      type: input.type === "RESEARCH_REPORT" ? "research" : "fact",
      title: `${artifact.type}: ${artifact.title}`,
      content: `Das Arbeitsergebnis „${artifact.title}“ liegt als Artefakt ${artifact.id} unter ${relativePath}. Die Datei bleibt auf dem Workspace, Memory speichert nur diesen Verweis.`,
      projectId: project?.id,
      sourceId: source.id,
      sourceType: "document",
      sourceReference: artifact.id,
      sourceUrl: absolutePath,
    });
    memoryEntryId = memory?.id;
  }

  await prisma.artifact.update({
    where: { id: artifact.id },
    data: {
      knowledgeSourceId,
      memoryEntryId,
      metadata: JSON.stringify({
        ...(input.metadata ?? {}),
        notes,
      }),
    },
  });

  await recordActivity({
    organizationId: input.organizationId,
    type: "artifact",
    title: artifact.title,
    description: relativePath ? `Abgelegt unter ${relativePath}.` : "Als externe Referenz registriert.",
    status: "prepared",
    jobId: input.jobId,
    projectId: project?.id,
    externalReference: artifact.id,
    metadata: {
      artifactId: artifact.id,
      relativePath: relativePath ?? null,
      version: versioning.version,
      knowledgeSourceId: knowledgeSourceId ?? null,
      memoryEntryId: memoryEntryId ?? null,
      notes,
    },
  });

  let reviewSessionId: string | undefined;
  let windowOpened = false;
  if (input.openReview && input.jobId && (absolutePath || input.externalReference)) {
    const review = await createReviewSession({
      organizationId: input.organizationId,
      jobId: input.jobId,
      artifactId: artifact.id,
      approvalRequestId: input.approvalRequestId,
      type: REVIEW_TYPE_OF[input.type] ?? "FILE",
      target: absolutePath ?? input.externalReference ?? "",
      resumeStep: input.resumeStep,
    });
    reviewSessionId = review.id;
    windowOpened = review.status === "AWAITING_REVIEW";
    await setJobExecution({
      organizationId: input.organizationId,
      jobId: input.jobId,
      status: "waiting_for_review",
      pauseReason: "review",
      resumeState: JSON.stringify({ reviewSessionId: review.id, artifactId: artifact.id }),
    });
    await enqueueWorkItem({
      organizationId: input.organizationId,
      jobId: input.jobId,
      kind: "review.wait",
      status: "waiting_review",
      idempotencyKey: `review:${review.id}`,
      payload: { reviewSessionId: review.id, artifactId: artifact.id },
    });
  }

  const location = relativePath ? `Datei: ${absolutePath}.` : "Keine Datei geschrieben.";
  const reviewNote = reviewSessionId
    ? windowOpened
      ? " Zur Prüfung geöffnet."
      : " Die Prüfung ist vorbereitet, das Fenster konnte nicht geöffnet werden."
    : "";
  return {
    ok: true,
    artifactId: artifact.id,
    relativePath,
    absolutePath,
    reviewSessionId,
    knowledgeSourceId,
    memoryEntryId,
    windowOpened,
    message: `${location}${reviewNote}${notes.length ? ` ${notes.join(" ")}` : ""}`.trim(),
  };
}

export async function markArtifactStatus(input: {
  organizationId: string;
  artifactId: string;
  status: ArtifactStatus;
}) {
  assertOrganizationId(input.organizationId);
  await prisma.artifact.updateMany({
    where: { id: input.artifactId, organizationId: input.organizationId },
    data: { status: input.status },
  });
}
