import { prisma } from "@/lib/prisma";
import { appCheckQuelle, codeAusLink, type CheckQuelle } from "@/lib/rankpilot/checks";

/**
 * Was hat gewirkt? Je Kampagne: gesendete Mails, echte Antworten, gestartete Checks (über den Kurzlink der Mail)
 * und daraus angelegte Konten in der App. Checks kommen aus der rankPilot-App (lib/rankpilot/checks.ts).
 */
export type Wirkung = {
  seit: string;
  checks_eingerichtet: boolean;
  hinweis?: string;
  kampagnen: Array<{ name: string; gesendet: number; antworten: number; checks: number; konten: number }>;
  checks: Array<{ firma: string; kampagne: string; zeit: string; konto_angelegt: boolean }>;
  /** Checks mit NOVA-Code, zu dem es hier keine Mail gibt (z. B. weitergeleiteter Link). */
  ohne_zuordnung: number;
};

export async function wirkung(input: { organizationId: string; seit: Date; bis?: Date; quelle?: CheckQuelle }): Promise<Wirkung> {
  const bis = input.bis ?? new Date();
  const mails = await prisma.communication.findMany({
    where: {
      organizationId: input.organizationId,
      direction: "outbound",
      status: "sent",
      campaignId: { not: null },
      sentAt: { gte: new Date(input.seit.getTime() - 60 * 86_400_000), lt: bis },
    },
    include: { campaign: true },
  });
  const nachCode = new Map<string, (typeof mails)[number]>();
  for (const mail of mails) {
    const code = codeAusLink(mail.externalUrl);
    if (code) nachCode.set(code, mail);
  }

  const kampagnen = new Map<string, { name: string; gesendet: number; antworten: number; checks: number; konten: number }>();
  const eintrag = (id: string, name: string) => {
    if (!kampagnen.has(id)) kampagnen.set(id, { name, gesendet: 0, antworten: 0, checks: 0, konten: 0 });
    return kampagnen.get(id)!;
  };
  for (const mail of mails) {
    if (mail.sentAt && mail.sentAt >= input.seit) eintrag(mail.campaignId!, mail.campaign?.name ?? "").gesendet += 1;
  }
  const antworten = await prisma.communication.findMany({
    where: { organizationId: input.organizationId, direction: "inbound", status: "received", campaignId: { not: null }, createdAt: { gte: input.seit, lt: bis } },
    include: { campaign: true },
  });
  for (const antwort of antworten) eintrag(antwort.campaignId!, antwort.campaign?.name ?? "").antworten += 1;

  const ergebnis = await (input.quelle ?? appCheckQuelle)(input.seit).catch((error: unknown) => ({
    eingerichtet: false as const,
    grund: `die App ist nicht erreichbar (${error instanceof Error ? error.message : String(error)})`,
  }));
  const checks: Wirkung["checks"] = [];
  let ohneZuordnung = 0;
  if (ergebnis.eingerichtet) {
    for (const check of ergebnis.checks) {
      const zeit = new Date(check.erstellt);
      if (zeit >= bis) continue;
      const mail = check.code ? nachCode.get(check.code) : undefined;
      if (!mail) {
        ohneZuordnung += 1;
        continue;
      }
      const k = eintrag(mail.campaignId!, mail.campaign?.name ?? "");
      k.checks += 1;
      if (check.konto_angelegt) k.konten += 1;
      checks.push({ firma: mail.recipientName ?? mail.toAddress ?? "", kampagne: mail.campaign?.name ?? "", zeit: check.erstellt, konto_angelegt: check.konto_angelegt });
    }
  }
  return {
    seit: input.seit.toISOString(),
    checks_eingerichtet: ergebnis.eingerichtet,
    ...(ergebnis.eingerichtet ? {} : { hinweis: `Checks werden noch nicht gezählt: ${ergebnis.grund}.` }),
    kampagnen: [...kampagnen.values()],
    checks,
    ohne_zuordnung: ohneZuordnung,
  };
}
