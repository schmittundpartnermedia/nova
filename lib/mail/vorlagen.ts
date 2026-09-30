import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";
import { fillMailTemplate, optionalePlatzhalterIn, platzhalterIn } from "@/lib/mail/templates";
import { gedankenstrichIn, ohneGedankenstrich } from "@/lib/mail/stil";

/**
 * Mail-Vorlagen des Nutzers: Dateien `~/Nova/vorlagen/<name>.md`.
 * Erste Zeile optional „Betreff: …“, danach der Text mit Platzhaltern {{…}}.
 * Beim Auflisten werden sie in `mail_templates` übernommen (Name = Dateiname).
 */

/** platzhalter: Pflicht ({{name}}); optional: Abschnitt {{#name}} … {{/name}} fällt ohne Wert weg. */
export type Vorlage = { name: string; betreff: string; text: string; platzhalter: string[]; optional: string[] };

export function vorlagenDir(): string {
  return path.join(novaHomeDir(), "vorlagen");
}

export function parseVorlage(name: string, raw: string): Vorlage {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let betreff = "";
  const first = lines[0]?.match(/^\s*betreff\s*:\s*(.*)$/i);
  if (first) {
    betreff = first[1]!.trim();
    lines.shift();
  }
  const text = lines.join("\n").trim();
  return { name, betreff, text, platzhalter: platzhalterIn(`${betreff}\n${text}`), optional: optionalePlatzhalterIn(text) };
}

export function leseVorlagen(): Vorlage[] {
  const dir = vorlagenDir();
  fs.mkdirSync(dir, { recursive: true });
  return fs
    .readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith(".md"))
    .sort()
    .map((file) => parseVorlage(file.replace(/\.md$/i, ""), fs.readFileSync(path.join(dir, file), "utf8")))
    .filter((vorlage) => vorlage.text.length > 0);
}

/** Übernimmt die Dateien in mail_templates; Vorlagen ohne Datei werden widerrufen. */
export async function importiereVorlagen(organizationId: string): Promise<Vorlage[]> {
  const vorlagen = leseVorlagen();
  const bestehend = await prisma.mailTemplate.findMany({ where: { organizationId, revokedAt: null } });
  for (const vorlage of vorlagen) {
    const row = bestehend.find((item) => item.name === vorlage.name);
    const data = { subject: vorlage.betreff || null, body: vorlage.text };
    if (row) await prisma.mailTemplate.update({ where: { id: row.id }, data });
    else await prisma.mailTemplate.create({ data: { organizationId, name: vorlage.name, ...data } });
  }
  const namen = new Set(vorlagen.map((vorlage) => vorlage.name));
  const weg = bestehend.filter((row) => !namen.has(row.name)).map((row) => row.id);
  if (weg.length) {
    await prisma.mailTemplate.updateMany({ where: { id: { in: weg } }, data: { revokedAt: new Date() } });
  }
  return vorlagen;
}

export function fuelleVorlage(
  name: string,
  werte: Record<string, string>,
): { betreff: string; text: string; fehlend: string[] } {
  const vorlage = leseVorlagen().find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
  if (!vorlage) throw new Error(`Vorlage „${name}“ gibt es nicht in ${vorlagenDir()}.`);
  if (gedankenstrichIn(`${vorlage.betreff}\n${vorlage.text}`)) {
    throw new Error(`Die Vorlage „${vorlage.name}“ enthält einen Gedankenstrich (– oder —). Mails gehen ohne Gedankenstrich raus, bitte die Vorlage anpassen.`);
  }
  const saubereWerte = Object.fromEntries(Object.entries(werte).map(([key, value]) => [key, ohneGedankenstrich(String(value ?? ""))]));
  const betreff = fillMailTemplate(vorlage.betreff, saubereWerte);
  const text = fillMailTemplate(vorlage.text, saubereWerte);
  return {
    betreff: betreff.text,
    text: text.text,
    fehlend: Array.from(new Set([...betreff.fehlend, ...text.fehlend])),
  };
}
