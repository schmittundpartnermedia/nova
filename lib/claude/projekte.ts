import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";

/**
 * Projekte, die NOVA an Claude Code geben darf. Standard hier; überschreibbar in ~/Nova/claude/projekte.json.
 * pruefen: Befehle, mit denen NOVA das Ergebnis selbst prüft. live: Skript, das veröffentlicht (nur nach Freigabe).
 */
export type ClaudeProjekt = { name: string; beschreibung: string; ordner: string; hauptzweig: string; pruefen: string[]; live: string };

const STANDARD: ClaudeProjekt[] = [
  {
    name: "webseite",
    beschreibung: "Webseite rankpilot.de (Astro)",
    ordner: "/Volumes/ELEVUM/Projekte/joachim/rankpilot-website",
    hauptzweig: "main",
    pruefen: ["npm run check", "npm run build"],
    live: "bash scripts/deploy-website.sh",
  },
  {
    name: "app",
    beschreibung: "App app.rankpilot.de",
    ordner: "/Volumes/ELEVUM/Projekte/joachim/rankPilot-app",
    hauptzweig: "main",
    pruefen: ["npm run check"],
    live: "bash scripts/deploy-rp.sh",
  },
];

export function claudeDir(): string {
  return path.join(novaHomeDir(), "claude");
}

export function leseProjekte(): ClaudeProjekt[] {
  const file = path.join(claudeDir(), "projekte.json");
  if (!fs.existsSync(file)) return STANDARD;
  return JSON.parse(fs.readFileSync(file, "utf8")) as ClaudeProjekt[];
}

export function projekt(name: string): ClaudeProjekt {
  const gefunden = leseProjekte().find((item) => item.name === name.trim().toLowerCase());
  if (!gefunden) throw new Error(`Projekt „${name}“ kenne ich nicht. Bekannt: ${leseProjekte().map((item) => item.name).join(", ")}.`);
  return gefunden;
}
