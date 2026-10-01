import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";

/**
 * Mailkonten, die NOVA liest (und von denen sie – wenn in lib/mail/steerable.ts erlaubt – sendet).
 * `~/Nova/mailkonten.txt`, eine Zeile je Konto: `adresse` oder `adresse imap=host:port smtp=host:port`.
 * Standard ist IONOS (imap.ionos.de:993, smtp.ionos.de:465, beide verschlüsselt).
 * Passwörter stehen NICHT dort, sondern je Konto in `~/Nova/geheim/mail/<adresse>` (nur für den Benutzer lesbar);
 * eingetragen von Joachim selbst (scripts/server/nova.sh passwort <adresse>).
 */

export type MailKontoZugang = {
  email: string;
  imap: { host: string; port: number };
  smtp: { host: string; port: number };
};

function hostPort(wert: string | undefined, standard: { host: string; port: number }) {
  if (!wert) return standard;
  const [host, port] = wert.split(":");
  return { host: host || standard.host, port: Number(port) || standard.port };
}

export function kontenDatei(): string {
  return path.join(novaHomeDir(), "mailkonten.txt");
}

export function mailKonten(): MailKontoZugang[] {
  let inhalt = "";
  try {
    inhalt = fs.readFileSync(kontenDatei(), "utf8");
  } catch {
    return [];
  }
  return inhalt
    .split("\n")
    .map((zeile) => zeile.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((zeile) => {
      const [email, ...rest] = zeile.split(/\s+/);
      const opt = Object.fromEntries(rest.map((teil) => teil.split("=") as [string, string]));
      return {
        email: email!.toLowerCase(),
        imap: hostPort(opt.imap, { host: "imap.ionos.de", port: 993 }),
        smtp: hostPort(opt.smtp, { host: "smtp.ionos.de", port: 465 }),
      };
    })
    .filter((konto) => konto.email.includes("@"));
}

export function passwortDatei(email: string): string {
  return path.join(novaHomeDir(), "geheim", "mail", email.trim().toLowerCase());
}

export function mailPasswort(email: string): string | null {
  try {
    const wert = fs.readFileSync(passwortDatei(email), "utf8").replace(/\r?\n$/, "");
    return wert || null;
  } catch {
    return null;
  }
}
