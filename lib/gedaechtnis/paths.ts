import os from "node:os";
import path from "node:path";

/** Dauergedächtnis des Nutzers – Dateien, nicht DB. */
export const GEDAECHTNIS_DATEIEN = ["firma", "kunden", "projekte"] as const;
export type GedaechtnisDatei = (typeof GEDAECHTNIS_DATEIEN)[number];

export function novaHomeDir(): string {
  const override = process.env.NOVA_HOME?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), "Nova");
}

export function gedaechtnisDir(): string {
  return path.join(novaHomeDir(), "gedaechtnis");
}

export function gedaechtnisFilePath(datei: GedaechtnisDatei): string {
  return path.join(gedaechtnisDir(), `${datei}.md`);
}

export function isGedaechtnisDatei(value: string): value is GedaechtnisDatei {
  return (GEDAECHTNIS_DATEIEN as readonly string[]).includes(value);
}
