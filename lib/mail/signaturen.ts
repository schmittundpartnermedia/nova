import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";

/**
 * Signatur je Absender als Textdatei: `~/Nova/signaturen/<adresse>.txt` (z. B. joachim@rankpilot.de.txt).
 * Wird unter jede Mail dieses Absenders gesetzt; **fett** ist erlaubt. Ohne Datei geht die Mail ohne Signatur raus.
 */
export function signaturenOrdner(): string {
  return path.join(novaHomeDir(), "signaturen");
}

export function signaturFuer(absender: string): string | undefined {
  const datei = path.join(signaturenOrdner(), `${absender.trim().toLowerCase()}.txt`);
  try {
    const text = fs.readFileSync(datei, "utf8").replace(/\s+$/, "");
    return text || undefined;
  } catch {
    return undefined;
  }
}

export function alleSignaturen(): Array<{ absender: string }> {
  try {
    return fs
      .readdirSync(signaturenOrdner())
      .filter((name) => name.endsWith(".txt") && name.includes("@"))
      .map((name) => ({ absender: name.slice(0, -4).toLowerCase() }))
      .filter((item) => signaturFuer(item.absender));
  } catch {
    return [];
  }
}
