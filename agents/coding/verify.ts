import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runDesktopAction } from "@/services/desktop-service/client";
import type { VerificationCheck, VerificationCheckStatus } from "@/lib/coding/types";
import type { ActionResult } from "@/lib/computer/types";

export type ProjectVerification = {
  overall: "VERIFIED" | "UNVERIFIED" | "FAILED";
  checks: VerificationCheck[];
  gitDiff: string;
  gitStatus: string;
  actions: ActionResult[];
};

export async function verifyProject(input: {
  organizationId: string;
  jobId?: string;
  projectPath: string;
  includeBuild?: boolean;
}): Promise<ProjectVerification> {
  const actions: ActionResult[] = [];
  const checks: VerificationCheck[] = [];
  const shell = async (argv: string[], purpose: string, timeoutMs = 60_000) => {
    const result = await runDesktopAction({
      organizationId: input.organizationId,
      jobId: input.jobId,
      requestId: randomUUID(),
      source: "nova_plan",
      tool: "shell",
      payload: { action: "execute", argv, cwd: input.projectPath, purpose, timeoutMs },
      userCommissioned: true,
    });
    actions.push(result);
    return result;
  };

  const status = await shell(["git", "status", "--short", "--branch"], "Git-Status", 15_000);
  const diffStat = await shell(["git", "diff", "--stat"], "Git-Diff Statistik", 15_000);
  const diff = await shell(["git", "diff"], "Git-Diff", 20_000);
  const gitStatus = stdout(status);
  const gitDiff = [stdout(diffStat), stdout(diff)].filter(Boolean).join("\n").slice(0, 12_000);
  checks.push(checkFrom("git.status", "git status", status));
  checks.push(checkFrom("git.diff", "git diff", diffStat.success || diff.success ? diffStat : diff));

  const pkg = readPackage(input.projectPath);
  if (!pkg) {
    checks.push({ id: "typescript", label: "TypeScript", status: "skipped", details: "Kein package.json." });
    checks.push({ id: "lint", label: "Lint", status: "skipped", details: "Kein package.json." });
    checks.push({ id: "tests", label: "Tests", status: "skipped", details: "Kein package.json." });
    checks.push({ id: "build", label: "Build", status: "skipped", details: "Kein package.json." });
  } else {
    checks.push(await runScriptCheck(shell, pkg, "typescript", "TypeScript", ["typecheck", "tsc"]));
    checks.push(await runScriptCheck(shell, pkg, "lint", "Lint", ["lint"]));
    checks.push(await runScriptCheck(shell, pkg, "tests", "Tests", ["test"]));
    if (input.includeBuild !== false) {
      checks.push(await runScriptCheck(shell, pkg, "build", "Build", ["build"]));
    } else {
      checks.push({ id: "build", label: "Build", status: "skipped", details: "Build für diesen Auftrag nicht angefordert." });
    }
  }

  const failed = checks.some((item) => item.status === "failed");
  const unverified = checks.some((item) => item.status === "unverified");
  const overall = failed ? "FAILED" : unverified ? "UNVERIFIED" : "VERIFIED";
  return { overall, checks, gitDiff, gitStatus, actions };
}

async function runScriptCheck(
  shell: (argv: string[], purpose: string, timeoutMs?: number) => Promise<ActionResult>,
  pkg: PackageJson,
  id: string,
  label: string,
  scriptNames: string[],
): Promise<VerificationCheck> {
  const script = scriptNames.find((name) => pkg.scripts?.[name]);
  if (!script) {
    if (id === "typescript" && fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ pkg.dir, "tsconfig.json"))) {
      const result = await shell(["npx", "tsc", "--noEmit"], "TypeScript prüfen", 120_000);
      return checkFrom(id, label, result);
    }
    return { id, label, status: "skipped", details: `Kein npm-Script ${scriptNames.join("/")}.` };
  }
  if (script === "test" && pkg.scripts?.test && /missing script|no test specified/i.test(pkg.scripts.test)) {
    return { id, label, status: "skipped", details: "Kein echter Test-Script." };
  }
  const result = await shell(["npm", "run", script], `${label} ausführen`, 180_000);
  return checkFrom(id, label, result);
}

function checkFrom(id: string, label: string, result: ActionResult): VerificationCheck {
  const details = [stdout(result), stderr(result), result.error?.message].filter(Boolean).join("\n").slice(0, 1500);
  let status: VerificationCheckStatus = "unverified";
  if (result.success && result.verification?.verified) status = "passed";
  else if (result.success === false) status = "failed";
  return { id, label, status, details: details || result.verification?.details || "keine Ausgabe" };
}

type PackageJson = { dir: string; scripts?: Record<string, string> };

function readPackage(projectPath: string): PackageJson | null {
  const file = path.join(/* turbopackIgnore: true */ projectPath, "package.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { scripts?: Record<string, string> };
    return { dir: projectPath, scripts: parsed.scripts };
  } catch {
    return null;
  }
}

function stdout(result: ActionResult): string {
  return String((result.result as { stdout?: string } | undefined)?.stdout ?? "").trim();
}

function stderr(result: ActionResult): string {
  return String((result.result as { stderr?: string } | undefined)?.stderr ?? "").trim();
}
