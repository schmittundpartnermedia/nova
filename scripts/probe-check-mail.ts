/**
 * Probe auf Joachims Zuruf: echter persönlicher Check für EINEN Betrieb, Mail mit der Vorlage kunden-check –
 * gesendet NUR an Joachims eigene Adressen (nicht an den Betrieb). Der Check bleibt am Betrieb gespeichert
 * (Status „check“), damit der echte Versand ihn wiederverwendet statt neu zu bezahlen.
 *   tsx scripts/probe-check-mail.ts <lead-email> <an1> [an2 …]
 */
import { prisma } from "@/lib/prisma";
import { OpenAIProvider } from "@/providers/ai/openai";
import { AppleMailPostfach } from "@/connectors/mail/apple";
import { checkLink, webseitenCheck } from "@/lib/rankpilot/persoenlicher-check";
import { neuerCheckCode } from "@/lib/rankpilot/checks";
import { anredeAus, verstehe } from "@/services/leads/profil";
import { formuliereBefunde } from "@/services/leads/befunde";
import { fuelleVorlage } from "@/lib/mail/vorlagen";
import { leseEinstellungen } from "@/services/tagesbetrieb/einstellungen";

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [leadEmail, ...an] = process.argv.slice(2);
  if (!leadEmail || !an.length) throw new Error("Aufruf: <lead-email> <an1> [an2 …]");
  const cfg = leseEinstellungen();
  const lead = await prisma.lead.findFirstOrThrow({ where: { organizationId: cfg.organizationId!, email: leadEmail } });
  if (!lead.website || !lead.ort) throw new Error("Betrieb ohne Website oder Ort.");
  const auswerter = new OpenAIProvider();
  const profil = await verstehe(lead, auswerter);
  console.log(`Betrieb: ${lead.firma} → ${profil.firmenname}, Suchwort „${profil.suchwort}“, Ort ${lead.ort}, Anrede „${anredeAus(profil)}“`);

  let checkId = lead.checkId;
  if (!checkId) {
    const person = profil.ansprechpartner;
    const start = await webseitenCheck.starte({
      siteUrl: lead.website,
      city: lead.ort,
      keyword: profil.suchwort,
      email: lead.email!,
      name: person ? [person.vorname, person.nachname].filter(Boolean).join(" ") : profil.firmenname,
      company: profil.firmenname,
      code: neuerCheckCode(),
    });
    if ("ortUnbekannt" in start) throw new Error(`Ort unbekannt: ${start.ortUnbekannt}`);
    checkId = start.checkId;
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "check", checkId } });
    console.log(`Check gestartet: ${checkId} (wiederverwendet: ${start.wiederverwendet})`);
  }
  const beginn = Date.now();
  for (;;) {
    const stand = await webseitenCheck.stand(checkId);
    if (stand.runStatus === "success") break;
    if (stand.runStatus === "failed") throw new Error(`Check fehlgeschlagen: ${checkId}`);
    if (Date.now() - beginn > 10 * 60_000) throw new Error("Check nach 10 Minuten nicht fertig.");
    await warte(15_000);
  }
  console.log(`Check fertig nach ${Math.round((Date.now() - beginn) / 1000)} s: ${checkLink(checkId)}`);
  const bericht = await webseitenCheck.bericht(checkId);
  const befunde = await formuliereBefunde({ lead, profil, bericht, auswerter });
  if (!befunde.length) throw new Error("Keine verwertbaren Ergebnisse im Bericht.");
  const gefuellt = fuelleVorlage("kunden-check", { anrede: anredeAus(profil), befunde: befunde.join("\n\n"), check_link: checkLink(checkId) });
  if (gefuellt.fehlend.length) throw new Error(`fehlende Werte: ${gefuellt.fehlend.join(", ")}`);
  console.log(`\nBetreff: ${gefuellt.betreff}\n\n${gefuellt.text}\n`);
  const postfach = new AppleMailPostfach();
  for (const empfaenger of an) {
    const r = await postfach.senden({ absender: cfg.absender, an: empfaenger, betreff: gefuellt.betreff, text: gefuellt.text });
    console.log(`an ${empfaenger}: ${r.ok ? "gesendet" : "NICHT gesendet"} – ${r.grund}`);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
  await prisma.$disconnect();
  process.exit(1);
});
