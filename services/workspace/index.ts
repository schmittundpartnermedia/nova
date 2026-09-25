import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { SYSTEM_DIRECTORIES } from "@/lib/workspace/layout";
import { safeRelative, slugify } from "@/lib/workspace/naming";
import { probeWorkspaceRoot } from "@/lib/workspace/root";
import type { WorkspaceRootStatus } from "@/types/workspace";

export type WorkspaceWriteResult<T> =
  | { ok: true; root: WorkspaceRootStatus; value: T }
  | { ok: false; root: WorkspaceRootStatus; message: string };

function rejectOffline(root: WorkspaceRootStatus): WorkspaceWriteResult<never> | null {
  if (root.availability === "AVAILABLE" && root.resolvedPath && root.writable) return null;
  return {
    ok: false,
    root,
    message: root.message,
  };
}

export function absoluteFromRoot(root: string, relativePath: string): string {
  const relative = safeRelative(relativePath);
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, relative);
  if (absolute !== resolvedRoot && !absolute.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Workspace-Pfad verlässt die Ablage.");
  }
  return absolute;
}

async function rememberEntry(input: {
  organizationId: string;
  projectId?: string | null;
  kind: string;
  title: string;
  relativePath: string;
  artifactId?: string | null;
  jobId?: string | null;
  source?: string;
  version?: number;
  metadata?: Record<string, unknown>;
}) {
  const relativePath = safeRelative(input.relativePath);
  const data = {
    kind: input.kind,
    title: input.title,
    slug: slugify(input.title),
    artifactId: input.artifactId ?? null,
    jobId: input.jobId ?? null,
    projectId: input.projectId ?? null,
    source: input.source ?? null,
    version: input.version ?? 1,
    status: "active",
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
  };
  return prisma.workspaceEntry.upsert({
    where: {
      organizationId_relativePath: {
        organizationId: input.organizationId,
        relativePath,
      },
    },
    create: {
      organizationId: input.organizationId,
      relativePath,
      ...data,
    },
    update: data,
  });
}

export async function ensureOperationalLayout(organizationId: string): Promise<WorkspaceWriteResult<{ rootPath: string }>> {
  assertOrganizationId(organizationId);
  const root = probeWorkspaceRoot();
  const blocked = rejectOffline(root);
  if (blocked || !root.resolvedPath) return blocked ?? { ok: false, root, message: root.message };
  for (const relative of SYSTEM_DIRECTORIES) {
    fs.mkdirSync(absoluteFromRoot(root.resolvedPath, relative), { recursive: true });
    await rememberEntry({
      organizationId,
      kind: "system",
      title: relative.split("/").pop() ?? relative,
      relativePath: relative,
      source: "workspace-manager",
    });
  }
  return { ok: true, root, value: { rootPath: root.resolvedPath } };
}

export async function ensureWorkspaceDir(input: {
  organizationId: string;
  relativeDir: string;
  title: string;
  projectId?: string | null;
  jobId?: string | null;
  kind?: string;
}): Promise<WorkspaceWriteResult<{ absolutePath: string; relativePath: string }>> {
  assertOrganizationId(input.organizationId);
  const ready = await ensureOperationalLayout(input.organizationId);
  if (!ready.ok) return { ok: false, root: ready.root, message: ready.message };
  if (!ready.root.resolvedPath) return { ok: false, root: ready.root, message: ready.root.message };
  const relativePath = safeRelative(input.relativeDir);
  const absolutePath = absoluteFromRoot(ready.root.resolvedPath, relativePath);
  fs.mkdirSync(absolutePath, { recursive: true });
  await rememberEntry({
    organizationId: input.organizationId,
    projectId: input.projectId,
    jobId: input.jobId,
    kind: input.kind ?? "folder",
    title: input.title,
    relativePath,
    source: "workspace-manager",
  });
  return { ok: true, root: ready.root, value: { absolutePath, relativePath } };
}

export async function writeWorkspaceFile(input: {
  organizationId: string;
  relativeDir: string;
  fileName: string;
  body: string;
  title: string;
  projectId?: string | null;
  jobId?: string | null;
  artifactId?: string | null;
  version?: number;
  source?: string;
}): Promise<WorkspaceWriteResult<{ absolutePath: string; relativePath: string }>> {
  const dir = await ensureWorkspaceDir({
    organizationId: input.organizationId,
    relativeDir: input.relativeDir,
    title: path.basename(input.relativeDir),
    projectId: input.projectId,
    jobId: input.jobId,
  });
  if (!dir.ok) return dir;
  const relativePath = safeRelative(dir.value.relativePath, input.fileName);
  const absolutePath = absoluteFromRoot(dir.root.resolvedPath!, relativePath);
  if (fs.existsSync(absolutePath)) {
    return {
      ok: false,
      root: dir.root,
      message: `Datei existiert bereits und wird nicht überschrieben: ${relativePath}`,
    };
  }
  fs.writeFileSync(absolutePath, input.body, { encoding: "utf8", flag: "wx" });
  await rememberEntry({
    organizationId: input.organizationId,
    projectId: input.projectId,
    jobId: input.jobId,
    artifactId: input.artifactId,
    kind: "artifact",
    title: input.title,
    relativePath,
    version: input.version,
    source: input.source,
  });
  return { ok: true, root: dir.root, value: { absolutePath, relativePath } };
}

export async function listWorkspaceManifest(organizationId: string) {
  assertOrganizationId(organizationId);
  const root = probeWorkspaceRoot();
  const entries = await prisma.workspaceEntry.findMany({
    where: { organizationId },
    orderBy: { relativePath: "asc" },
  });
  return {
    root,
    entries: entries.map((entry) => {
      const present =
        root.availability === "AVAILABLE" && root.resolvedPath
          ? fs.existsSync(absoluteFromRoot(root.resolvedPath, entry.relativePath))
          : false;
      return {
        ...entry,
        present,
        readable: root.availability === "AVAILABLE" && present,
      };
    }),
  };
}

export function workspaceStatus() {
  return probeWorkspaceRoot();
}
