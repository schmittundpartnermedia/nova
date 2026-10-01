import crypto from "node:crypto";
import { spawn } from "node:child_process";

/**
 * Zugangsdaten für Plattform-Konten (Phase 7) – ausschließlich im macOS-Schlüsselbund (`security`).
 * Eintrag: Dienst „NOVA: <plattform>“, Konto = Benutzername/E-Mail. NOVA erzeugt das Passwort selbst;
 * es steht nie in Datenbank, Dateien, Gesprächsverlauf oder Werkzeugergebnis. Ausgefüllt wird es nur über {{passwort}}.
 * Das Passwort wird über die Eingabe von `security -i` übergeben, nicht als Programmargument (sonst in der Prozessliste sichtbar).
 */

export type Schluesselbund = {
  speichere(dienst: string, konto: string, passwort: string): Promise<void>;
  /** Konto (Benutzername) zum Dienst, ohne Passwort; null wenn es keinen Eintrag gibt. */
  konto(dienst: string): Promise<string | null>;
  passwort(dienst: string): Promise<string | null>;
};

export function dienstName(plattform: string): string {
  return `NOVA: ${plattform.trim()}`;
}

/** Starkes Passwort, das Plattform-Regeln meist erfüllt (Groß, klein, Ziffer, Sonderzeichen, 20 Zeichen). */
export function erzeugePasswort(): string {
  const gruppen = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!#%+-=?_"];
  const alle = gruppen.join("");
  const zeichen = gruppen.map((g) => g[crypto.randomInt(g.length)]!);
  while (zeichen.length < 20) zeichen.push(alle[crypto.randomInt(alle.length)]!);
  for (let i = zeichen.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [zeichen[i], zeichen[j]] = [zeichen[j]!, zeichen[i]!];
  }
  return zeichen.join("");
}

function security(args: string[], eingabe?: string): Promise<{ code: number; aus: string }> {
  return new Promise((resolve, reject) => {
    const kind = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "pipe"] });
    let aus = "";
    kind.stdout.on("data", (d: Buffer) => (aus += d.toString("utf8")));
    kind.stderr.on("data", (d: Buffer) => (aus += d.toString("utf8")));
    kind.on("error", reject);
    kind.on("close", (code) => resolve({ code: code ?? 1, aus }));
    if (eingabe) kind.stdin.write(eingabe);
    kind.stdin.end();
  });
}

/** Für `security -i`: Wert in doppelte Anführungszeichen, Backslash und Anführungszeichen maskiert. */
function zitiert(wert: string): string {
  return `"${wert.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export const macSchluesselbund: Schluesselbund = {
  async speichere(dienst, konto, passwort) {
    const befehl = `add-generic-password -U -s ${zitiert(dienst)} -a ${zitiert(konto)} -l ${zitiert(dienst)} -w ${zitiert(passwort)}\n`;
    const { code, aus } = await security(["-i"], befehl);
    if (code !== 0 || /error|fehler/i.test(aus)) throw new Error(`Schlüsselbund: Speichern fehlgeschlagen (${aus.trim().slice(0, 120)}).`);
  },
  async konto(dienst) {
    const { code, aus } = await security(["find-generic-password", "-s", dienst]);
    if (code !== 0) return null;
    return aus.match(/"acct"<blob>="([^"]*)"/)?.[1] ?? null;
  },
  async passwort(dienst) {
    const { code, aus } = await security(["find-generic-password", "-s", dienst, "-w"]);
    return code === 0 ? aus.replace(/\n$/, "") : null;
  },
};

const globalRef = globalThis as unknown as { __novaSchluesselbund?: Schluesselbund };

/** Tests setzen einen Schlüsselbund im Speicher; sonst der echte macOS-Schlüsselbund. */
export function schluesselbund(): Schluesselbund {
  return globalRef.__novaSchluesselbund ?? macSchluesselbund;
}

export function setzeSchluesselbund(bund: Schluesselbund | null): void {
  globalRef.__novaSchluesselbund = bund ?? undefined;
}
