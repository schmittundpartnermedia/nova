import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";

/**
 * Projekte, die NOVA an Claude Code geben kann: jeder Git-Ordner im Projektordner (Server: /home/nova/projekte)
 * (änderbar per NOVA_PROJEKTE_DIR), automatisch erkannt. Ausgenommen: NOVA selbst und Doppel (gleiches GitHub-Repo).
 * Zum Testen/Überschreiben: ~/Nova/claude/projekte.json.
 * pruefen: Befehle, mit denen NOVA das Ergebnis selbst prüft. live: Veröffentlichungs-Skript (nur nach Freigabe);
 * ohne Skript heißt „live“: in den Hauptzweig übernehmen und hochladen.
 */
export type ClaudeProjekt = {
  name: string;
  beschreibung: string;
  ordner: string;
  hauptzweig: string;
  pruefen: string[];
  live: string | null;
  /** Ohne GitHub-Remote wird nur lokal gespeichert, nichts hochgeladen. */
  remote: boolean;
  /** bereit | ohne_stand (Git ohne ersten Commit) */
  zustand: "bereit" | "ohne_stand";
  aliase: string[];
};

const BEKANNT: Record<string, { beschreibung: string; live?: string; aliase?: string[] }> = {
  "rankpilot-website": { beschreibung: "Webseite rankpilot.de", live: "bash scripts/deploy-website.sh", aliase: ["webseite", "rankpilot.de", "website"] },
  "rankPilot-app": { beschreibung: "App app.rankpilot.de", live: "bash scripts/deploy-rp.sh", aliase: ["app", "app.rankpilot.de", "rankpilot-app"] },
};

const AUSGENOMMEN = new Set(["NOVA"]);

export function projekteRoot(): string {
  return process.env.NOVA_PROJEKTE_DIR?.trim() || "/Volumes/ELEVUM/Projekte/joachim";
}

export function claudeDir(): string {
  return path.join(novaHomeDir(), "claude");
}

function git(ordner: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: ordner, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function paketInfo(ordner: string): { beschreibung?: string; scripts: string[] } {
  const file = path.join(ordner, "package.json");
  if (!fs.existsSync(file)) return { scripts: [] };
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8")) as { description?: string; scripts?: Record<string, string> };
    return { beschreibung: pkg.description, scripts: Object.keys(pkg.scripts ?? {}) };
  } catch {
    return { scripts: [] };
  }
}

function erkenne(): ClaudeProjekt[] {
  const root = projekteRoot();
  if (!fs.existsSync(root)) return [];
  const projekte: ClaudeProjekt[] = [];
  const remotes = new Map<string, string>();
  const ordnerNamen = fs
    .readdirSync(root)
    .filter((name) => !AUSGENOMMEN.has(name) && fs.existsSync(path.join(root, name, ".git")))
    // Bekannte Namen zuerst, damit bei Doppeln der eindeutige Ordner gewinnt.
    .sort((a, b) => Number(Boolean(BEKANNT[b])) - Number(Boolean(BEKANNT[a])) || a.localeCompare(b));
  for (const ordnerName of ordnerNamen) {
    const ordner = path.join(root, ordnerName);
    const remote = git(ordner, ["remote", "get-url", "origin"]);
    if (remote) {
      if (remotes.has(remote)) continue; // Doppel desselben GitHub-Repos
      remotes.set(remote, ordnerName);
    }
    const bekannt = BEKANNT[ordnerName];
    const paket = paketInfo(ordner);
    const pruefen = ["check", "typecheck", "build"].filter((script) => paket.scripts.includes(script)).map((script) => `npm run ${script}`);
    const hatStand = git(ordner, ["rev-parse", "--verify", "HEAD"]) !== "";
    projekte.push({
      name: ordnerName.trim().toLowerCase().replace(/\s+/g, "-"),
      beschreibung: bekannt?.beschreibung ?? (paket.beschreibung?.trim() || `Projekt ${ordnerName.trim()}`),
      ordner,
      hauptzweig: git(ordner, ["branch", "--show-current"]) || "main",
      pruefen,
      live: bekannt?.live ?? null,
      remote: Boolean(remote),
      zustand: hatStand ? "bereit" : "ohne_stand",
      aliase: bekannt?.aliase ?? [],
    });
  }
  return projekte;
}

export function leseProjekte(): ClaudeProjekt[] {
  const file = path.join(claudeDir(), "projekte.json");
  if (fs.existsSync(file)) {
    return (JSON.parse(fs.readFileSync(file, "utf8")) as Array<Partial<ClaudeProjekt> & { name: string; ordner: string }>).map((p) => ({
      beschreibung: p.name,
      hauptzweig: "main",
      pruefen: [],
      live: null,
      remote: true,
      zustand: "bereit" as const,
      aliase: [],
      ...p,
    }));
  }
  return erkenne();
}

/** Ordner ohne Git, die Claude deshalb nicht bekommt (für die Selbstauskunft). */
export function ordnerOhneGit(): string[] {
  const root = projekteRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((eintrag) => eintrag.isDirectory() && !eintrag.name.startsWith(".") && !fs.existsSync(path.join(root, eintrag.name, ".git")))
    .map((eintrag) => eintrag.name.trim());
}

export function projekt(name: string): ClaudeProjekt {
  const gesucht = name.trim().toLowerCase();
  const alle = leseProjekte();
  const gefunden = alle.find((item) => item.name === gesucht || item.aliase.includes(gesucht));
  if (!gefunden) throw new Error(`Projekt „${name}“ kenne ich nicht. Bekannt: ${alle.map((item) => item.name).join(", ")}.`);
  return gefunden;
}
