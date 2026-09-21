import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { runComputerUnitTests } from "@/lib/computer/unit-tests";
import { startDesktopService } from "@/services/desktop-service/server";
import { desktopHealth, fetchCapabilities, runDesktopAction } from "@/agents/computer/client";
import { readOrCreateDesktopToken } from "@/lib/computer/config";
import { detectCodingIntent } from "@/agents/coding/intent";
import { runCodingAgent, cancelCodingWork } from "@/agents/coding";
import { discoverCursor } from "@/services/desktop-service/adapters/cursor";
import { classifyComputerAction } from "@/lib/computer/risk";

const prisma = new PrismaClient();
const E2E_DIR = path.join(os.tmpdir(), "nova-coding-e2e");

async function main() {
  const unitFailures = runComputerUnitTests();
  if (unitFailures.length > 0) {
    throw new Error(`Unit-Tests fehlgeschlagen:\n${unitFailures.join("\n")}`);
  }

  readOrCreateDesktopToken();
  let server: Awaited<ReturnType<typeof startDesktopService>> | null = null;
  try {
    server = await startDesktopService();
  } catch (error) {
    if (!(await desktopHealth())) throw error;
  }

  const organization = await prisma.organization.findUnique({ where: { slug: "joachim" } });
  if (!organization) {
    throw new Error("Seed fehlt. Bitte zuerst prisma migrate + seed ausführen.");
  }

  fs.rmSync(E2E_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DIR, { recursive: true, mode: 0o700 });
  const { spawnSync } = await import("node:child_process");
  spawnSync("git", ["init"], { cwd: E2E_DIR, encoding: "utf8" });

  const discovery = await discoverCursor(true);
  const caps = await fetchCapabilities();
  const cursorCap = caps.capabilities.find((item) => item.id === "cursor.agent");

  const websiteIntent = detectCodingIntent(
    `Erstelle eine kleine Testseite mit Überschrift, Text und Button in ${E2E_DIR}.`,
  );
  const implementIntent = detectCodingIntent("Ändere auf rankPilot die Startseite und lass Cursor das umsetzen.");
  const stopIntent = detectCodingIntent("NOVA stop");

  const result = await runCodingAgent({
    organizationId: organization.id,
    userRequest: `Erstelle eine kleine Testseite mit Überschrift, Text und Button in ${E2E_DIR}.`,
  });

  const files = fs.existsSync(E2E_DIR) ? fs.readdirSync(E2E_DIR) : [];
  const htmlWritten = files.some((name) => name.endsWith(".html"));

  const pushRisk = classifyComputerAction({
    tool: "cursor",
    action: "agent",
    target: "git push origin main",
    userCommissioned: true,
  });

  const stop = await cancelCodingWork(organization.id);
  const stopRun = await runCodingAgent({
    organizationId: organization.id,
    userRequest: "NOVA stop",
  });

  const available = await runDesktopAction({
    organizationId: organization.id,
    requestId: "coding-available",
    source: "nova_plan",
    tool: "cursor",
    payload: { action: "available" },
    userCommissioned: true,
  });

  const checks = {
    unitTests: unitFailures.length === 0,
    websiteIntent: websiteIntent.kind === "website_build",
    implementIntent: implementIntent.kind === "implement",
    stopIntent: stopIntent.kind === "cancel",
    cursorCliFound: discovery.available === true && discovery.kind === "agent-cli",
    cursorCapability: cursorCap?.status === "AVAILABLE",
    honestAuthOrVerified: discovery.authenticated
      ? result.verified === true && htmlWritten
      : /nicht angemeldet|agent login/i.test(result.reply) && result.verified === false,
    noFakeVerified: discovery.authenticated || result.status !== "VERIFIED",
    noHtmlIfUnauth: discovery.authenticated || htmlWritten === false,
    pushNeedsApproval: pushRisk.approvalRequired === true,
    stopWorks: stopRun.status === "CANCELLED_BY_USER",
    availableProbe: available.success === true,
    isolatedDir: E2E_DIR.startsWith(os.tmpdir()),
    sessionRecorded: Boolean(result.sessionId) || /login|nicht angemeldet|nicht verfügbar/i.test(result.reply),
  };

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  const report = {
    checks,
    failed,
    discovery: {
      available: discovery.available,
      kind: discovery.kind,
      version: discovery.version,
      authenticated: discovery.authenticated,
      reason: discovery.reason,
    },
    coding: {
      status: result.status,
      verified: result.verified,
      reply: result.reply.slice(0, 500),
      sessionId: result.sessionId ?? null,
      checks: result.checks,
    },
    files,
    stop: { count: stop.count, status: stopRun.status },
  };
  console.log(JSON.stringify(report, null, 2));

  server?.close();
  if (failed.length > 0) {
    throw new Error(`Coding-Verifikation fehlgeschlagen: ${failed.join(", ")}`);
  }
  console.log("NOVA Coding-Verifikation erfolgreich.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
