import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";

/**
 * Welche Apple-Mail-Signatur zu welchem Absender gehört: `~/Nova/signaturen.txt`,
 * eine Zeile je Konto, z. B. `joachim@rankpilot.de = rankpilot Joachim`.
 */
export function signaturenDatei(): string {
  return path.join(novaHomeDir(), "signaturen.txt");
}

export function alleSignaturen(): Array<{ absender: string; signatur: string }> {
  const file = signaturenDatei();
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.match(/^\s*([^\s=#]+@[^\s=]+)\s*=\s*(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ absender: match[1]!.toLowerCase(), signatur: match[2]! }));
}

export function signaturFuer(absender: string): string | undefined {
  const email = absender.trim().toLowerCase();
  return alleSignaturen().find((item) => item.absender === email)?.signatur;
}
