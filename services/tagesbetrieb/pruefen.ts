import { promises as dns } from "node:dns";
import { prisma } from "@/lib/prisma";
import { aufSperrliste } from "@/lib/mail/sperrliste";

/**
 * Prüfung einer Kunden-Adresse vor dem Anschreiben:
 * gültige Form · Domain nimmt Mail an (MX, sonst A) · nicht auf der Sperrliste ·
 * Adresse und Domain wurden noch nie angeschrieben.
 */

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
/** Freemail-Domains: hier gilt die Adresse, nicht die ganze Domain, als „schon angeschrieben“. */
const FREEMAIL = new Set(["gmail.com", "googlemail.com", "gmx.de", "gmx.net", "web.de", "t-online.de", "yahoo.de", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "freenet.de", "aol.com"]);

export type MxPruefer = (domain: string) => Promise<boolean>;

export const echterMxPruefer: MxPruefer = async (domain) => {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.some((eintrag) => eintrag.exchange)) return true;
  } catch {
    // kein MX – RFC 5321 erlaubt Zustellung an den A-Eintrag
  }
  try {
    return (await dns.resolve4(domain)).length > 0;
  } catch {
    return false;
  }
};

export async function pruefeAdresse(input: {
  organizationId: string;
  email: string | null | undefined;
  mx: MxPruefer;
  ohneLeadId?: string;
}): Promise<{ ok: true } | { ok: false; grund: string }> {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, grund: "keine E-Mail-Adresse" };
  if (!EMAIL.test(email)) return { ok: false, grund: "keine gültige E-Mail-Adresse" };
  const domain = email.split("@").pop()!;
  if (aufSperrliste(email)) return { ok: false, grund: "steht auf der Sperrliste" };
  const schonAdresse = await prisma.communication.count({
    where: { organizationId: input.organizationId, direction: "outbound", toAddress: email, status: { in: ["sent", "draft"] } },
  });
  if (schonAdresse) return { ok: false, grund: "wurde schon angeschrieben" };
  if (!FREEMAIL.has(domain)) {
    const schonDomain = await prisma.communication.count({
      where: { organizationId: input.organizationId, direction: "outbound", status: "sent", toAddress: { endsWith: `@${domain}` } },
    });
    if (schonDomain) return { ok: false, grund: `Firma (${domain}) wurde schon angeschrieben` };
  }
  if (!(await input.mx(domain))) return { ok: false, grund: `Domain ${domain} nimmt keine Mail an` };
  return { ok: true };
}
