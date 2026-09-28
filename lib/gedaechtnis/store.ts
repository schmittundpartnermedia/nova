import fs from "node:fs";
import path from "node:path";
import {
  GEDAECHTNIS_DATEIEN,
  gedaechtnisDir,
  gedaechtnisFilePath,
  isGedaechtnisDatei,
  type GedaechtnisDatei,
} from "@/lib/gedaechtnis/paths";
import { redactSecrets } from "@/lib/secrets";

const EMPTY_TEMPLATES: Record<GedaechtnisDatei, string> = {
  firma: "# Firma\n\nNoch nichts hinterlegt.\n",
  kunden: "# Kunden\n\nNoch nichts hinterlegt.\n",
  projekte: "# Projekte\n\nNoch nichts hinterlegt.\n",
};

export function ensureGedaechtnis(): void {
  const dir = gedaechtnisDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const datei of GEDAECHTNIS_DATEIEN) {
    const file = gedaechtnisFilePath(datei);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, EMPTY_TEMPLATES[datei], "utf8");
    }
  }
}

export function lesenGedaechtnis(datei: GedaechtnisDatei): string {
  ensureGedaechtnis();
  return fs.readFileSync(gedaechtnisFilePath(datei), "utf8");
}

export function schreibenGedaechtnis(datei: GedaechtnisDatei, inhalt: string): string {
  ensureGedaechtnis();
  const cleaned = redactSecrets(inhalt.trim());
  if (!cleaned) {
    throw new Error("Leerer Inhalt – nichts geschrieben.");
  }
  const body = cleaned.endsWith("\n") ? cleaned : `${cleaned}\n`;
  const file = gedaechtnisFilePath(datei);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
  return body;
}

/** Hängt einen Eintrag an (für „Merk dir …“), statt die Datei zu überschreiben. */
export function ergaenzeGedaechtnis(datei: GedaechtnisDatei, eintrag: string): string {
  ensureGedaechtnis();
  const cleaned = redactSecrets(eintrag.trim());
  if (!cleaned) {
    throw new Error("Leerer Eintrag – nichts geschrieben.");
  }
  const file = gedaechtnisFilePath(datei);
  const existing = fs.readFileSync(file, "utf8").trimEnd();
  const isEmpty = /Noch nichts hinterlegt\.?\s*$/m.test(existing) && existing.split("\n").length <= 4;
  const next = isEmpty
    ? `# ${datei[0]!.toUpperCase()}${datei.slice(1)}\n\n- ${cleaned}\n`
    : `${existing}\n\n- ${cleaned}\n`;
  fs.writeFileSync(file, next, "utf8");
  return next;
}

export function ladeAlleGedaechtnisDateien(): Record<GedaechtnisDatei, string> {
  ensureGedaechtnis();
  const out = {} as Record<GedaechtnisDatei, string>;
  for (const datei of GEDAECHTNIS_DATEIEN) {
    out[datei] = lesenGedaechtnis(datei);
  }
  return out;
}

export function parseGedaechtnisDatei(value: unknown): GedaechtnisDatei {
  const raw = String(value ?? "").trim().toLowerCase().replace(/\.md$/, "");
  if (!isGedaechtnisDatei(raw)) {
    throw new Error(`Unbekannte Gedächtnisdatei: ${raw}. Erlaubt: ${GEDAECHTNIS_DATEIEN.join(", ")}.`);
  }
  return raw;
}

export function gedaechtnisSystemBlock(): string {
  const all = ladeAlleGedaechtnisDateien();
  const parts = GEDAECHTNIS_DATEIEN.map((datei) => `### ${datei}.md\n${all[datei].trim()}`);
  return `## Dauergedächtnis (Dateien in ~/Nova/gedaechtnis/)\n\n${parts.join("\n\n")}`;
}
