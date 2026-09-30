import fs from "node:fs";
import path from "node:path";
import { kampagnenDir } from "@/lib/mail/kontaktlisten";

/**
 * Sperrliste `~/Nova/kampagnen/sperrliste.txt`: eine Adresse oder Domain (@firma.de) je Zeile, `# Grund` optional.
 * Wer hier steht, wird von Kampagnen und Tagesbetrieb nie (wieder) angeschrieben.
 */
export function sperrlisteDatei(): string {
  return path.join(kampagnenDir(), "sperrliste.txt");
}

export function leseSperrliste(): string[] {
  const file = sperrlisteDatei();
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim().toLowerCase())
    .filter(Boolean);
}

export function aufSperrliste(email: string, sperrliste = leseSperrliste()): boolean {
  const adresse = email.trim().toLowerCase();
  const domain = adresse.split("@").pop() ?? "";
  return sperrliste.some((eintrag) => eintrag === adresse || eintrag === `@${domain}` || eintrag === domain);
}

/** Trägt eine Adresse oder Domain ein (nicht doppelt). Gibt false zurück, wenn sie schon gesperrt war. */
export function sperre(eintrag: string, grund: string): boolean {
  const clean = eintrag.trim().toLowerCase();
  if (!/^@?[^\s@]+(@[^\s@]+)?\.[^\s@]+$/.test(clean)) throw new Error(`„${eintrag}“ ist keine Adresse oder Domain.`);
  if (leseSperrliste().includes(clean)) return false;
  fs.mkdirSync(kampagnenDir(), { recursive: true });
  const zeile = `${clean}${grund.trim() ? `  # ${grund.trim().replace(/\n/g, " ")}` : ""}\n`;
  fs.appendFileSync(sperrlisteDatei(), zeile, "utf8");
  return true;
}
