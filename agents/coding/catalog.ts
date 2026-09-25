import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { prisma } from "@/lib/prisma";
import { defaultWorkspaceRoots } from "@/lib/computer/paths";

export type ResolvedCodingProject = {
  name: string;
  projectId?: string;
  localPath: string;
  created: boolean;
  source: "context" | "project" | "filesystem" | "created";
};

const ALIASES: Array<{ key: string; names: string[] }> = [
  { key: "rankpilot", names: ["rankpilot", "rank-pilot", "rank_pilot"] },
  { key: "planexus", names: ["planexus"] },
  { key: "elevum", names: ["elevum"] },
  { key: "nova", names: ["nova"] },
];

export async function resolveCodingProject(input: {
  organizationId: string;
  userRequest: string;
  projectHint?: string;
  createIfMissing?: boolean;
}): Promise<ResolvedCodingProject | { needsPath: true; name: string; reason: string }> {
  const explicitPath = extractExplicitPath(input.userRequest);
  if (explicitPath) {
    return {
      name: path.basename(explicitPath),
      localPath: explicitPath,
      created: false,
      source: "filesystem",
    };
  }
  const hint = input.projectHint ?? inferHint(input.userRequest);
  const name = hint ? displayName(hint) : inferNewSiteName(input.userRequest) ?? "Neues Projekt";

  const existing = await findExisting(input.organizationId, hint, name);
  if (existing) return existing;

  if (hint === "nova") {
    return {
      name: "NOVA",
      localPath: process.cwd(),
      created: false,
      source: "filesystem",
    };
  }

  if (input.createIfMissing) {
    const dir = uniqueDir(name);
    fs.mkdirSync(dir, { recursive: true });
    const project = await prisma.project.findFirst({
      where: { organizationId: input.organizationId, name },
    });
    const saved =
      project ??
      (await prisma.project.create({
        data: { organizationId: input.organizationId, name, description: "Von NOVA für einen Coding-Auftrag angelegt.", status: "active" },
      }));
    return { name, projectId: saved.id, localPath: dir, created: true, source: "created" };
  }

  return {
    needsPath: true,
    name,
    reason: `Ich habe keinen lokalen Pfad für ${name} gefunden. Bitte nenne mir den Projektordner.`,
  };
}

async function findExisting(organizationId: string, hint: string | undefined, name: string): Promise<ResolvedCodingProject | null> {
  const context = await prisma.projectContext.findFirst({
    where: {
      organizationId,
      OR: hint
        ? [{ project: { name: { contains: name } } }, { localPath: { contains: hint } }]
        : [{ project: { name: { contains: name } } }],
    },
    include: { project: true },
    orderBy: { updatedAt: "desc" },
  });
  if (context?.localPath && fs.existsSync(context.localPath)) {
    return {
      name: context.project.name,
      projectId: context.projectId,
      localPath: context.localPath,
      created: false,
      source: "context",
    };
  }

  const project = await prisma.project.findFirst({
    where: { organizationId, name: { contains: name } },
    orderBy: { updatedAt: "desc" },
  });
  if (project) {
    const related = await prisma.projectContext.findUnique({ where: { projectId: project.id } });
    if (related?.localPath && fs.existsSync(related.localPath)) {
      return { name: project.name, projectId: project.id, localPath: related.localPath, created: false, source: "project" };
    }
  }

  const fromFs = hint ? findDirectoryByAlias(hint) : findDirectoryByAlias(name.toLowerCase());
  if (fromFs) {
    return { name, localPath: fromFs, created: false, source: "filesystem" };
  }
  return null;
}

function extractExplicitPath(request: string): string | undefined {
  const match = request.match(
    /(?:^|[\s"'`])(\/(?:tmp|var\/folders|private\/var\/folders|Users|Volumes|home)\/[^\s"'`]+)/,
  );
  const candidate = match?.[1];
  if (!candidate) return undefined;
  const resolved = path.resolve(candidate);
  if (fs.existsSync(resolved)) return resolved;
  return undefined;
}

function inferHint(request: string): string | undefined {
  const withoutPaths = request.replace(/(?:^|[\s"'`])\/[^\s"'`]+/g, " ");
  const lower = withoutPaths.toLowerCase();
  return ALIASES.find((item) => item.names.some((name) => lower.includes(name)))?.key;
}

function displayName(hint: string): string {
  if (hint === "rankpilot") return "rankPilot";
  if (hint === "planexus") return "planexus";
  if (hint === "elevum") return "ELEVUM";
  if (hint === "nova") return "NOVA";
  return hint;
}

function inferNewSiteName(request: string): string | undefined {
  const match = request.match(/website\s+für\s+([A-ZÄÖÜa-zäöüß0-9._-]+)/i) ?? request.match(/für\s+firma\s+([A-ZÄÖÜa-zäöüß0-9._-]+)/i);
  return match?.[1];
}

function findDirectoryByAlias(alias: string): string | null {
  const names = ALIASES.find((item) => item.key === alias.toLowerCase())?.names ?? [alias.toLowerCase()];
  const roots = [...defaultWorkspaceRoots(), process.cwd(), path.dirname(process.cwd())];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const lower = entry.name.toLowerCase();
      if (names.some((name) => lower === name || lower.includes(name))) {
        return path.join(root, entry.name);
      }
    }
  }
  return null;
}

function uniqueDir(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "website";
  const base = path.join(os.homedir(), "Documents", `${safe}-website`);
  if (!fs.existsSync(base)) return base;
  return `${base}-${Date.now()}`;
}
