/**
 * Einmalig (02.10.2026): nachgeprüfte Schreinereien in NOVAs Vorrat übernehmen und 5 Betriebe mit dem echten Modell
 * verstehen lassen (Probe für Joachim: Anrede, Gewerk, Suchwort). Läuft gegen die echte Datenbank.
 *   tsx scripts/einlesen-nachgeprueft.ts <nachgeprueft.csv> [anzahl-probe]
 */
import { prisma } from "@/lib/prisma";
import { leseLeadsEin, pruefeNeueLeads } from "@/services/leads";
import { echterMxPruefer } from "@/services/tagesbetrieb/pruefen";
import { verstehe, anredeAus } from "@/services/leads/profil";
import { OpenAIProvider } from "@/providers/ai/openai";
import { leseEinstellungen } from "@/services/tagesbetrieb/einstellungen";

async function main() {
  const csv = process.argv[2];
  if (!csv) throw new Error("Pfad zur nachgeprüften CSV fehlt.");
  const anzahl = Number(process.argv[3] ?? 5);
  const org = leseEinstellungen().organizationId;
  if (!org) throw new Error("Keine Organisation in ~/Nova/tagesbetrieb.json.");
  const vorher = await prisma.lead.groupBy({ by: ["status"], where: { organizationId: org }, _count: true });
  const ein = await leseLeadsEin(org, csv, { branche: "Schreinerei" });
  const pruef = await pruefeNeueLeads(org, echterMxPruefer);
  const nachher = await prisma.lead.groupBy({ by: ["status"], where: { organizationId: org }, _count: true });
  console.log("Einlesen:", ein, "Prüfung:", pruef);
  console.log("vorher:", Object.fromEntries(vorher.map((g) => [g.status, g._count])));
  console.log("nachher:", Object.fromEntries(nachher.map((g) => [g.status, g._count])));

  const auswerter = new OpenAIProvider();
  const kanzleiter = await prisma.lead.findFirst({ where: { organizationId: org, firma: { contains: "Kanzleiter" } } });
  const weitere = await prisma.lead.findMany({
    where: { organizationId: org, status: "geprueft", texte: { contains: "impressum" }, NOT: { id: kanzleiter?.id ?? "" } },
    orderBy: [{ score: "desc" }],
    take: Math.max(0, anzahl - 1),
  });
  for (const lead of [kanzleiter, ...weitere].filter((l): l is NonNullable<typeof l> => Boolean(l))) {
    const p = await verstehe({ ...lead, profil: null }, auswerter);
    console.log(`\n${lead.firma} (${lead.email})`);
    console.log(`  Anrede: ${anredeAus(p)},  | Firmenname: ${p.firmenname} | Gewerk: ${p.gewerk} | Suchwort: ${p.suchwort}`);
    console.log(`  Leistungen: ${p.leistungen.join(", ")}`);
    console.log(`  Ansprechpartner: ${p.ansprechpartner ? `${p.ansprechpartner.anrede} ${p.ansprechpartner.vorname ?? ""} ${p.ansprechpartner.nachname} (${p.ansprechpartner.rolle})` : "keiner sicher"}${p.hinweis ? ` | Hinweis: ${p.hinweis}` : ""}`);
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
