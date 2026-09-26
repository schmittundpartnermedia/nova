import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { runDevelopmentUnitTests } from "@/lib/development/unit-tests";
import { commissionDevelopment } from "@/services/development/commission";
import { explainDevelopment } from "@/services/development/status";
import { tickWorker } from "@/services/worker/runtime";
import { runDevelopmentWork } from "@/services/development/run";
import { handleReviewUtterance } from "@/services/review/handle";
import { applyDevelopmentReview } from "@/services/development/review";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  const unit = runDevelopmentUnitTests();
  assert(unit.length === 0, unit.join("\n"));

  const prisma = new PrismaClient();
  const organization = await prisma.organization.findUnique({ where: { slug: "joachim" } });
  assert(organization, "Organisation joachim fehlt");
  const orgId = organization!.id;

  const dir = fs.mkdtempSync(path.join(process.cwd(), ".nova", "dev-e2e-"));
  execFileSync("git", ["init"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "Prüfprojekt für den NOVA-Entwicklungsauftrag.\n");

  const request = `NOVA, ich möchte, dass du in ${dir} eine Datei bereit.txt anlegst, deren Inhalt genau das Wort bereit ist.`;
  const commissioned = await commissionDevelopment({ organizationId: orgId, userRequest: request });
  await prisma.developmentOrder.update({
    where: { id: commissioned.orderId },
    data: { workspacePath: dir },
  });
  const created = await prisma.developmentOrder.findUnique({ where: { id: commissioned.orderId } });
  assert(created?.status === "planned", "Auftrag nicht geplant");
  assert(created?.userRequest === request, "Ursprünglicher Wunsch fehlt");

  const explained = await explainDevelopment(orgId, "Woran arbeitet Cursor gerade?");
  assert(/Stand der Entwicklungsaufträge|Cursor arbeitet/.test(explained.reply), "Statusantwort fehlt");
  assert(/planned|developing/.test(explained.reply), "Auftragsstatus fehlt in der Statusantwort");

  await tickWorker("verify-development");
  const after = await prisma.developmentOrder.findUnique({ where: { id: commissioned.orderId } });
  assert(after, "Auftrag nach dem Lauf fehlt");
  assert(after!.userRequest === request, "Wunsch wurde überschrieben");
  assert(after!.status !== "verified", "Ein Lauf darf sich nicht selbst als verifiziert bezeichnen");
  const file = path.join(dir, "bereit.txt");
  const fileOk = fs.existsSync(file) && fs.readFileSync(file, "utf8").trim() === "bereit";
  if (fileOk) {
    assert(after!.status === "waiting_review", `Geprüfte Datei wartet nicht auf Abnahme: ${after!.status}`);
    const active = await prisma.reviewSession.findFirst({
      where: { organizationId: orgId, status: { in: ["AWAITING_REVIEW", "OPENING", "FAILED"] } },
      orderBy: { createdAt: "desc" },
    });
    const review =
      active?.jobId === commissioned.jobId
        ? await handleReviewUtterance({ organizationId: orgId, userRequest: "Passt." })
        : await applyDevelopmentReview({
            organizationId: orgId,
            jobId: commissioned.jobId,
            command: { kind: "approve", alsoSend: false },
          });
    const done = await prisma.developmentOrder.findUnique({ where: { id: commissioned.orderId } });
    assert(review?.status === "completed" && done?.status === "completed", "Abnahme hat den Auftrag nicht abgeschlossen");
  } else {
    assert(
      after!.status === "blocked" || after!.status === "failed" || after!.status === "planned" || after!.status === "developing",
      `Unerwarteter Status ohne Ergebnis: ${after!.status}`,
    );
    assert(after!.status !== "waiting_review" && after!.status !== "completed", "Ohne Ergebnis als fertig markiert");
  }

  const stable = await prisma.developmentOrder.findUnique({ where: { id: commissioned.orderId } });
  if (stable && ["completed", "blocked", "failed", "waiting_review"].includes(stable.status)) {
    const item = await prisma.workItem.findFirst({
      where: { organizationId: orgId, idempotencyKey: `development:${commissioned.orderId}:0` },
    });
    if (item) {
      await runDevelopmentWork({
        id: item.id,
        organizationId: orgId,
        jobId: item.jobId,
        payload: { orderId: commissioned.orderId },
      });
    }
    const still = await prisma.developmentOrder.findUnique({ where: { id: commissioned.orderId } });
    assert(still?.status === stable.status, "Erneuter Lauf hat einen abgeschlossenen Auftrag verändert");
  }

  console.log(
    JSON.stringify({
      unit: "ok",
      order: commissioned.orderId,
      status: stable?.status,
      file: fileOk,
      cursorSession: stable?.cursorSessionId ?? null,
      summary: stable?.resultSummary ?? null,
      workspace: dir,
    }),
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "verify-development");
  process.exit(1);
});
