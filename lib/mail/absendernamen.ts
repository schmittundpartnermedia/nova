import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";

/**
 * Anzeigename je Absender (was der Empfänger im Posteingang als Absender sieht): `~/Nova/absendernamen.txt`,
 * eine Zeile je Konto, z. B. `joachim@rankpilot.de = rankPilot Joachim Schmitt`. Ohne Eintrag steht nur
 * die Adresse als Absender.
 */
export function absendernamenDatei(): string {
  return path.join(novaHomeDir(), "absendernamen.txt");
}

export function absendernameFuer(absender: string): string | undefined {
  const file = absendernamenDatei();
  if (!fs.existsSync(file)) return undefined;
  const email = absender.trim().toLowerCase();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([^\s=#]+@[^\s=]+)\s*=\s*(.+?)\s*$/);
    if (match && match[1]!.toLowerCase() === email) return match[2]!.replace(/[<>"]/g, "").trim() || undefined;
  }
  return undefined;
}

/** Absender: „Name <adresse>“ oder nur die Adresse. */
export function absenderMitName(email: string): string {
  const name = absendernameFuer(email);
  return name ? `${name} <${email}>` : email;
}
