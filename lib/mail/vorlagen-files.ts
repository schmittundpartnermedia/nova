import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";
import { fillMailTemplate, type TemplateVars } from "@/lib/mail/templates";
import { prisma } from "@/lib/prisma";
import { redactSecrets } from "@/lib/secrets";

export function vorlagenDir(): string {
  return path.join(novaHomeDir(), "vorlagen");
}

export function ensureVorlagenDir(): void {
  fs.mkdirSync(vorlagenDir(), { recursive: true });
}

export type VorlagenDatei = {
  name: string;
  dateiname: string;
  inhalt: string;
};

export function listeVorlagenDateien(): VorlagenDatei[] {
  ensureVorlagenDir();
  const dir = vorlagenDir();
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .sort()
    .map((dateiname) => {
      const inhalt = fs.readFileSync(path.join(dir, dateiname), "utf8");
      return {
        name: dateiname.replace(/\.md$/i, ""),
        dateiname,
        inhalt,
      };
    });
}

export function leseVorlage(name: string): VorlagenDatei {
  ensureVorlagenDir();
  const bare = name.trim().replace(/\.md$/i, "");
  const dateiname = `${bare}.md`;
  const file = path.join(vorlagenDir(), dateiname);
  if (!fs.existsSync(file)) {
    throw new Error(`Vorlage nicht gefunden: ${dateiname} in ~/Nova/vorlagen/`);
  }
  return { name: bare, dateiname, inhalt: fs.readFileSync(file, "utf8") };
}

export function fuelleVorlage(name: string, vars: TemplateVars): { name: string; text: string } {
  const vorlage = leseVorlage(name);
  return { name: vorlage.name, text: fillMailTemplate(vorlage.inhalt, vars) };
}

/** Importiert Datei-Vorlagen in mail_templates (DB), damit Communication/DB weiterhin greifen. */
export async function importVorlagenInDb(organizationId: string): Promise<number> {
  const files = listeVorlagenDateien();
  let count = 0;
  for (const file of files) {
    const body = redactSecrets(file.inhalt.trim());
    if (!body) continue;
    const existing = await prisma.mailTemplate.findFirst({
      where: { organizationId, name: file.name, revokedAt: null },
    });
    if (existing) {
      await prisma.mailTemplate.update({
        where: { id: existing.id },
        data: { body, kind: existing.kind || "outreach" },
      });
    } else {
      await prisma.mailTemplate.create({
        data: {
          organizationId,
          name: file.name,
          kind: "outreach",
          body,
        },
      });
    }
    count += 1;
  }
  return count;
}
