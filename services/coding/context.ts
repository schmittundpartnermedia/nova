import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { upsertDurableMemory } from "@/services/memory";
import { redactSecrets } from "@/lib/computer/redaction";
import { wrapExternalContent } from "@/lib/computer/injection";
import { runDesktopAction } from "@/agents/computer/client";

export type LoadedProjectContext = {
  projectId: string;
  name: string;
  localPath: string;
  repository?: string;
  branch?: string;
  framework?: string;
  architecture?: string;
  rules?: string;
  decisions?: string;
  openItems?: string;
  lastChanges?: string;
  refreshed: boolean;
};

const FRESH_MS = 24 * 60 * 60 * 1000;

export async function loadAndRefreshProjectContext(input: {
  organizationId: string;
  jobId?: string;
  projectId?: string;
  name: string;
  localPath: string;
  userRequest: string;
}): Promise<LoadedProjectContext> {
  assertOrganizationId(input.organizationId);
  const project =
    (input.projectId
      ? await prisma.project.findFirst({ where: { id: input.projectId, organizationId: input.organizationId } })
      : await prisma.project.findFirst({ where: { organizationId: input.organizationId, name: input.name } })) ??
    (await prisma.project.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        description: "Coding-Projektkontext",
        status: "active",
      },
    }));

  const existing = await prisma.projectContext.findUnique({ where: { projectId: project.id } });
  const fresh = existing?.lastAnalyzedAt && Date.now() - existing.lastAnalyzedAt.getTime() < FRESH_MS;
  const snapshot = await captureRepoSnapshot({
    organizationId: input.organizationId,
    jobId: input.jobId,
    localPath: input.localPath,
    full: !fresh,
  });

  const architecture = fresh ? existing?.architecture : snapshot.architecture;
  const data = {
    organizationId: input.organizationId,
    projectId: project.id,
    localPath: input.localPath,
    repository: snapshot.repository ?? existing?.repository,
    branch: snapshot.branch ?? existing?.branch,
    framework: snapshot.framework ?? existing?.framework,
    architecture,
    rules: snapshot.rules ?? existing?.rules,
    decisions: existing?.decisions,
    openItems: existing?.openItems,
    lastChanges: snapshot.lastChanges,
    lastAnalyzedAt: new Date(),
    metadata: JSON.stringify({ source: "coding-agent", refreshed: !fresh }),
  };

  const saved = existing
    ? await prisma.projectContext.update({ where: { id: existing.id }, data })
    : await prisma.projectContext.create({ data });

  await upsertDurableMemory({
    organizationId: input.organizationId,
    type: "project",
    title: `Projektkontext: ${project.name}`,
    content: redactSecrets(
      [
        `Pfad: ${saved.localPath}`,
        saved.repository ? `Repo: ${saved.repository}` : "",
        saved.branch ? `Branch: ${saved.branch}` : "",
        saved.framework ? `Framework: ${saved.framework}` : "",
        saved.architecture ? `Architektur: ${saved.architecture}` : "",
        saved.lastChanges ? `Letzte Änderungen: ${saved.lastChanges}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    projectId: project.id,
    sourceType: "nova",
    sourceReference: input.jobId,
  });

  return {
    projectId: project.id,
    name: project.name,
    localPath: saved.localPath ?? input.localPath,
    repository: saved.repository ?? undefined,
    branch: saved.branch ?? undefined,
    framework: saved.framework ?? undefined,
    architecture: saved.architecture ?? undefined,
    rules: saved.rules ?? undefined,
    decisions: saved.decisions ?? undefined,
    openItems: saved.openItems ?? undefined,
    lastChanges: saved.lastChanges ?? undefined,
    refreshed: !fresh,
  };
}

async function captureRepoSnapshot(input: {
  organizationId: string;
  jobId?: string;
  localPath: string;
  full: boolean;
}) {
  const git = async (argv: string[]) =>
    runDesktopAction({
      organizationId: input.organizationId,
      jobId: input.jobId,
      requestId: `git-${argv.join("-")}-${Date.now()}`,
      source: "nova_plan",
      tool: "shell",
      payload: { action: "execute", argv: ["git", ...argv], cwd: input.localPath, purpose: "Projektkontext Git", timeoutMs: 15_000 },
      userCommissioned: true,
    });

  const status = await git(["status", "--short", "--branch"]);
  const log = await git(["log", "-5", "--oneline"]);
  const remote = await git(["remote", "get-url", "origin"]);
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const statusOut = stdoutOf(status);
  const lastChanges = [statusOut, stdoutOf(log)].filter(Boolean).join("\n").slice(0, 2000);

  let framework: string | undefined;
  let architecture: string | undefined;
  let rules: string | undefined;
  if (input.full) {
    const pkgPath = path.join(/* turbopackIgnore: true */ input.localPath, "package.json");
    if (fs.existsSync(/* turbopackIgnore: true */ pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        framework = detectFramework(deps);
      } catch {
        framework = "unbekannt";
      }
    } else if (fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ input.localPath, "index.html"))) {
      framework = "static-html";
    }
    const top = fs
      .readdirSync(input.localPath)
      .filter((name) => !name.startsWith(".git"))
      .slice(0, 30);
    architecture = `Top-Level: ${top.join(", ")}`;
    const agentsMd = readIfExists(path.join(/* turbopackIgnore: true */ input.localPath, "AGENTS.md"));
    const cursorRules = readIfExists(path.join(/* turbopackIgnore: true */ input.localPath, ".cursorrules"));
    const combined = [agentsMd, cursorRules].filter(Boolean).join("\n");
    if (combined) {
      const untrusted = wrapExternalContent("repo-rules", combined);
      rules = untrusted.text.slice(0, 2000);
    }
  }

  return {
    repository: stdoutOf(remote) || undefined,
    branch: stdoutOf(branch) || undefined,
    lastChanges,
    framework,
    architecture,
    rules,
  };
}

function stdoutOf(result: { result?: unknown }): string {
  const stdout = (result.result as { stdout?: string } | undefined)?.stdout;
  return typeof stdout === "string" ? stdout.trim() : "";
}

function detectFramework(deps: Record<string, string>): string {
  if (deps.next) return "nextjs";
  if (deps.nuxt) return "nuxt";
  if (deps.astro) return "astro";
  if (deps.react) return "react";
  if (deps.vue) return "vue";
  if (deps.svelte) return "svelte";
  return "node";
}

function readIfExists(file: string): string {
  try {
    if (!fs.existsSync(file)) return "";
    return fs.readFileSync(file, "utf8").slice(0, 4000);
  } catch {
    return "";
  }
}
