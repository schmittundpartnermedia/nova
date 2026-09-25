import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { runWorkspaceUnitTests } from "@/lib/workspace/unit-tests";
import { runReviewUnitTests } from "@/lib/review/unit-tests";
import { runWorkerUnitTests } from "@/lib/worker/unit-tests";
import { probeWorkspaceRoot } from "@/lib/workspace/root";
import { getCurrentTenant } from "@/services/tenant";
import {
  cancelWorkItem,
  enqueueWorkItem,
  pauseWorkItem,
  resumeWorkItem,
  withExternalEffect,
} from "@/services/worker/queue";
import { registerWorkHandler, tickWorker } from "@/services/worker/runtime";
import { runMaster } from "@/agents/master";
import { hasOpenAIApiKey } from "@/lib/secrets";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const failures = [...runWorkspaceUnitTests(), ...runReviewUnitTests(), ...runWorkerUnitTests()];
  if (failures.length) throw new Error(failures.join("\n"));

  const root = probeWorkspaceRoot();
  console.log(`WORKSPACE ${root.availability} ${root.resolvedPath ?? ""} ${root.message}`);
  assert(root.availability === "AVAILABLE", root.message);
  assert(root.resolvedPath?.startsWith("/Volumes/"), "Workspace liegt nicht auf einem gemounteten Volume.");

  const missing = probeWorkspaceRoot();
  const previous = process.env.NOVA_WORKSPACE_ROOT;
  process.env.NOVA_WORKSPACE_ROOT = "/Volumes/NOVA-VOLUME-NICHT-VERBUNDEN";
  const offline = (await import("@/lib/workspace/root")).probeWorkspaceRoot();
  if (previous === undefined) delete process.env.NOVA_WORKSPACE_ROOT;
  else process.env.NOVA_WORKSPACE_ROOT = previous;
  assert(offline.availability === "UNAVAILABLE", `Offline-Status falsch: ${offline.availability}`);
  assert(missing.availability === "AVAILABLE", "Der echte Workspace darf durch den Offline-Test nicht umgeschrieben werden.");

  const tenant = await getCurrentTenant();
  const stamp = Date.now().toString(36);

  const queued = await enqueueWorkItem({
    organizationId: tenant.organizationId,
    kind: "system.ping",
    idempotencyKey: `verify-ping-${stamp}`,
    payload: { stamp },
  });
  const duplicate = await enqueueWorkItem({
    organizationId: tenant.organizationId,
    kind: "system.ping",
    idempotencyKey: `verify-ping-${stamp}`,
  });
  assert(duplicate.id === queued.id, "Idempotenter Enqueue hat ein Duplikat angelegt.");
  await tickWorker(`verify-${stamp}`);
  const ping = await prisma.workItem.findFirst({ where: { id: queued.id } });
  assert(ping?.status === "completed", `Ping-Job nicht completed: ${ping?.status}`);

  const held = await enqueueWorkItem({
    organizationId: tenant.organizationId,
    kind: "system.ping",
    idempotencyKey: `verify-pause-${stamp}`,
  });
  await pauseWorkItem(held.id, tenant.organizationId, "test");
  await tickWorker(`verify-pause-${stamp}`);
  const paused = await prisma.workItem.findFirst({ where: { id: held.id } });
  assert(paused?.status === "paused", "Pause wurde ausgeführt.");
  await resumeWorkItem(held.id, tenant.organizationId);
  await tickWorker(`verify-resume-${stamp}`);
  const resumed = await prisma.workItem.findFirst({ where: { id: held.id } });
  assert(resumed?.status === "completed", `Resume nicht completed: ${resumed?.status}`);

  const doomed = await enqueueWorkItem({
    organizationId: tenant.organizationId,
    kind: "system.ping",
    idempotencyKey: `verify-cancel-${stamp}`,
  });
  await cancelWorkItem(doomed.id, tenant.organizationId, "test");
  await tickWorker(`verify-cancel-${stamp}`);
  const cancelled = await prisma.workItem.findFirst({ where: { id: doomed.id } });
  assert(cancelled?.status === "cancelled", "Abbruch wurde nicht gehalten.");

  let runs = 0;
  registerWorkHandler("verify.external", async (item) => {
    const effect = await withExternalEffect({
      organizationId: item.organizationId,
      workItemId: item.id,
      idempotencyKey: `effect-${stamp}`,
      effectType: "verify",
      run: async () => {
        runs += 1;
        return { ok: true };
      },
    });
    if (effect.decision === "needs_verification") return { ok: false, retry: false, note: "needs_verification" };
    return { ok: true, note: effect.decision };
  });
  const external = await enqueueWorkItem({
    organizationId: tenant.organizationId,
    kind: "verify.external",
    idempotencyKey: `verify-external-${stamp}`,
  });
  await tickWorker(`verify-ext-1-${stamp}`);
  const externalDone = await prisma.workItem.findFirst({ where: { id: external.id } });
  assert(externalDone?.status === "completed", `Externe Testaktion nicht abgeschlossen: ${externalDone?.status}`);
  await enqueueWorkItem({
    organizationId: tenant.organizationId,
    kind: "verify.external",
    idempotencyKey: `verify-external-2-${stamp}`,
  });
  await tickWorker(`verify-ext-2-${stamp}`);
  assert(runs === 1, `Externe Aktion lief ${runs} Mal.`);

  const uncertain = await enqueueWorkItem({
    organizationId: tenant.organizationId,
    kind: "system.ping",
    idempotencyKey: `verify-uncertain-${stamp}`,
    status: "running",
  });
  await prisma.workItem.update({
    where: { id: uncertain.id },
    data: { externalEffect: "intent", lockedUntil: new Date(Date.now() - 5_000), attempts: 1 },
  });
  await prisma.workEffect.create({
    data: {
      organizationId: tenant.organizationId,
      workItemId: uncertain.id,
      idempotencyKey: `uncertain-${stamp}`,
      effectType: "verify",
      status: "intent",
    },
  });
  const { recoverExpiredLeases } = await import("@/services/worker/queue");
  await recoverExpiredLeases(new Date());
  const recovered = await prisma.workItem.findFirst({ where: { id: uncertain.id } });
  assert(recovered?.status === "needs_verification", `Recovery hat wiederholt statt geprüft: ${recovered?.status}`);

  if (!hasOpenAIApiKey()) {
    console.log("E2E_RESEARCH NEIN kein OpenAI-Key");
    console.log("WINDOW NEIN");
    return;
  }

  const request = "Recherchiere kurz, was ein Workspace-Index in einem persönlichen Assistenten leistet, und lege das Ergebnis ab.";
  const researched = await runMaster({ organizationId: tenant.organizationId, userRequest: request });
  console.log(`MASTER ${researched.status}`);
  const artifact = await prisma.artifact.findFirst({
    where: { organizationId: tenant.organizationId, jobId: researched.jobId, type: "RESEARCH_REPORT" },
    orderBy: { createdAt: "desc" },
  });
  if (!artifact?.storagePath || !root.resolvedPath) {
    throw new Error("Recherche hat kein Artefakt auf dem Workspace abgelegt.");
  }
  const absolute = path.join(root.resolvedPath, artifact.storagePath);
  assert(fs.existsSync(absolute), `Datei fehlt: ${absolute}`);
  const body = fs.readFileSync(absolute, "utf8");
  assert(body.includes("Workspace") || body.length > 40, "Datei enthält kein Rechercheergebnis.");
  assert(artifact.knowledgeSourceId, "Knowledge-Index fehlt am Artefakt.");
  const memory = artifact.memoryEntryId
    ? await prisma.memoryEntry.findFirst({ where: { id: artifact.memoryEntryId } })
    : null;
  assert(memory && !memory.content.includes(body), "Memory enthält die Datei als Volltext.");
  const review = await prisma.reviewSession.findFirst({
    where: { organizationId: tenant.organizationId, jobId: researched.jobId },
    orderBy: { createdAt: "desc" },
  });
  assert(review, "Keine ReviewSession.");
  console.log(`FILE ${absolute}`);
  console.log(`REVIEW ${review.status} ${review.application ?? ""}`);
  console.log(`WINDOW ${review.status === "AWAITING_REVIEW" ? "JA" : "NEIN"}`);

  const approved = await runMaster({ organizationId: tenant.organizationId, userRequest: "Passt." });
  assert(approved.jobId === researched.jobId, "Freigabe hat einen neuen Auftrag geöffnet.");
  const closed = await prisma.reviewSession.findFirst({ where: { id: review.id } });
  assert(closed?.status === "APPROVED", `Review nicht freigegeben: ${closed?.status}`);
  const job = await prisma.job.findFirst({ where: { id: researched.jobId } });
  assert(job?.status === "completed", `Job nicht abgeschlossen: ${job?.status}`);
  const archive = await prisma.activity.findFirst({
    where: { organizationId: tenant.organizationId, jobId: researched.jobId, type: "review" },
  });
  assert(archive, "Archiv ohne Review-Eintrag.");
  console.log("E2E_RESEARCH JA");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
