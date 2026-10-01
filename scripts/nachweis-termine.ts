/**
 * Nachweis Termine gegen das echte Modell – OHNE echtes Postfach, OHNE echten Kalender:
 * Test-Postfach, Kalender im Speicher, Wegwerf-Datenbank und -NOVA_HOME.
 * Ein Betrieb antwortet „Rufen Sie mich Donnerstag an“ → Postfach-Wache schlägt vor, trägt nichts ein →
 * Joachim sagt „Ja, um 10“ → Termin gespeichert, im Kalender, Erinnerung geplant → Erinnerung über den Worker-Takt.
 * Ausgabe: docs/nachweis-termine.txt
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wegwerfDatenbank } from "./lib/wegwerf-db";

// Deutsche Zeit wie auf dem Server (pm2: TZ=Europe/Berlin), unabhängig vom Rechner, auf dem der Test läuft.
process.env.TZ = "Europe/Berlin";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-nachweis-termine-"));
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const match = line.match(/^\s*OPENAI_API_KEY\s*=\s*"?([^"\n]*)"?/);
  if (match && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = match[1];
}
process.env.NOVA_HOME = path.join(tmp, "home");

const lines: string[] = [];
function log(line = "") {
  lines.push(line);
  console.log(line);
}
function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
  log(`  ✓ ${message}`);
}

async function main() {
  wegwerfDatenbank();

  const { prisma } = await import("@/lib/prisma");
  const { runHeadLoop, verlaufsInhalt, jetztText } = await import("@/agents/master/head");
  const { OpenAIProvider } = await import("@/providers/ai/openai");
  const { HEAD_MODEL } = await import("@/providers/ai/models");
  const { postfachWache } = await import("@/services/kampagnen/wache");
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  const { encodeMailRef, decodeMailRef } = await import("@/services/mail/postfach");
  const { setzeKalender } = await import("@/lib/kalender");
  const { tickWorker } = await import("@/services/worker/runtime");
  type Postfach = import("@/services/mail/postfach").Postfach;
  type MailVoll = import("@/services/mail/postfach").MailVoll;

  const kalender: Array<{ titel: string; beginn: Date; notiz?: string }> = [];
  setzeKalender({
    async eintragen(e) {
      kalender.push({ titel: e.titel, beginn: e.beginn, notiz: e.notiz });
      return { ok: true, kalender: "Arbeit", uid: `uid-${kalender.length}` };
    },
    async aendern(ort) {
      return { ok: true, kalender: ort.kalender, uid: ort.uid };
    },
    async entfernen() {
      return { ok: true };
    },
  });

  const org = await prisma.organization.create({ data: { name: "Nachweis", slug: `nachweis-${Date.now()}` } });
  let posteingang: MailVoll[] = [];
  const postfach: Postfach = {
    neueste: async (input) => posteingang.slice(0, input.anzahl),
    eingang: async (input) =>
      posteingang
        .filter((mail) => new Date(mail.eingang) >= input.seit)
        .map((mail) => ({ ...mail, messageId: (decodeMailRef(mail.ref)?.messageId ?? "").replace(/^<|>$/g, "").toLowerCase(), bezuege: ["k1@test"], automatisch: false })),
    lesen: async (ref) => posteingang.find((mail) => mail.ref === ref) ?? null,
    senden: async () => ({ ok: false, executed: false, grund: "Nachweis: kein Versand" }),
    antworten: async () => ({ ok: false, executed: false, grund: "Nachweis: kein Versand" }),
  };
  const provider = new OpenAIProvider();
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  async function sag(satz: string) {
    const result = await runHeadLoop({ provider, model: HEAD_MODEL, history, userRequest: satz, context: { organizationId: org.id, postfach } });
    log();
    log(`Joachim: ${satz}`);
    log(`Werkzeuge: ${JSON.stringify(result.toolsExecuted.map((t) => ({ name: t.name, executed: t.executed })))}`);
    log(`NOVA: ${result.reply}`);
    history.push({ role: "user", content: satz }, { role: "assistant", content: verlaufsInhalt(result.reply, result.werkzeugNotiz) });
    return result;
  }

  log(`NOVA Nachweis Termine – ${new Date().toISOString()} – jetzt laut Kopf: ${jetztText()}`);
  log(`Modell: ${HEAD_MODEL} (echte API). Postfach: Test-Postfach. Kalender: im Speicher (kein echter Kalender).`);

  // Eine gesendete Tagesbetriebs-Mail an die Schreinerei Weber (gestern).
  const gestern = new Date(Date.now() - 86_400_000);
  const kampagne = await prisma.campaign.create({
    data: { organizationId: org.id, name: "Tagesbetrieb", vorlage: "kunden", liste: "kunden", absender: "check@b2b-rankpilot.de", abstandMinuten: 5, art: "tagesbetrieb", status: "laeuft", startedAt: gestern },
  });
  await prisma.communication.create({
    data: {
      organizationId: org.id, channel: "email", direction: "outbound", subject: "Ihre Sichtbarkeit bei Google", body: "…", status: "sent", deliveryStatus: "VERIFIED",
      fromAddress: "check@b2b-rankpilot.de", toAddress: "info@schreinerei-weber.example", recipientName: "Schreinerei Weber", campaignId: kampagne.id, sentAt: gestern, externalReference: "<k1@test>",
    },
  });
  posteingang = [
    {
      ref: encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "900", messageId: "<antwort-weber@example>" }),
      konto: "check@b2b-rankpilot.de",
      von: "Thomas Weber <info@schreinerei-weber.example>",
      betreff: "Re: Ihre Sichtbarkeit bei Google",
      eingang: new Date().toISOString(),
      gelesen: false,
      an: ["check@b2b-rankpilot.de"],
      cc: [],
      textanfang: "Guten Tag, rufen Sie mich Donnerstag an.",
      text: "Guten Tag,\n\ndas klingt interessant. Rufen Sie mich Donnerstag an, am besten vormittags. Telefon 07231 123456.\n\nGruß\nThomas Weber\nSchreinerei Weber",
    },
  ];

  log();
  log("— Antwort der Schreinerei Weber geht ein, Postfach-Wache läuft —");
  const wache = await postfachWache({ organizationId: org.id, postfach, kopf: { provider, model: HEAD_MODEL } });
  check(wache.neueAntworten === 1, "Antwort erkannt");
  const meldung = (await holeNeueMeldungen(org.id))[0];
  log(`NOVA (Meldung): ${meldung?.text}`);
  check(Boolean(meldung) && /donnerstag/i.test(meldung!.text) && /eintragen|Termin|Kalender/i.test(meldung!.text) && /\?/.test(meldung!.text), "Meldung nennt Donnerstag und fragt, ob sie eintragen soll");
  check((await prisma.termin.count()) === 0 && kalender.length === 0, "noch nichts eingetragen");
  const zeile = await prisma.conversationMessage.findUniqueOrThrow({ where: { id: meldung!.id } });
  const notiz = String((JSON.parse(zeile.metadata ?? "{}") as { werkzeuge?: string }).werkzeuge ?? "");
  history.push({ role: "assistant", content: verlaufsInhalt(meldung!.text, notiz) });

  const t1 = await sag("Ja, trag es ein, um 10 Uhr.");
  check(t1.toolsExecuted.some((t) => t.name === "termin_anlegen" && t.executed), "termin_anlegen ausgeführt");
  const termin = await prisma.termin.findFirstOrThrow({ where: { organizationId: org.id } });
  log(`  Termin: „${termin.titel}“, ${termin.beginn.toString()}, Notiz: ${termin.notiz}, Quelle: ${termin.quelleId}`);
  check(termin.beginn.getDay() === 4 && termin.beginn.getHours() === 10 && termin.beginn.getMinutes() === 0 && termin.beginn > new Date(), "Donnerstag 10:00, in der Zukunft");
  check(/weber/i.test(termin.titel), "Titel nennt Weber");
  check(/123456/.test(`${termin.titel} ${termin.notiz ?? ""}`), "Telefonnummer übernommen");
  const antwortMail = await prisma.communication.findFirstOrThrow({ where: { direction: "inbound" } });
  check(termin.quelleId === antwortMail.id, "Quelle ist die Antwort-Mail");
  check(kalender.length === 1, "im Kalender eingetragen");
  const erinnerung = await prisma.workItem.findFirstOrThrow({ where: { kind: "termin.erinnerung" } });
  check(erinnerung.runAt.getTime() === termin.beginn.getTime() - 15 * 60_000, "Erinnerung 15 Minuten vorher geplant");

  const t2 = await sag("Was steht nächste Woche an?");
  check(t2.toolsExecuted.some((t) => t.name === "termine_anzeigen" || t.name === "tagesueberblick"), "liest die Termine");
  check(/weber/i.test(t2.reply), "nennt den Rückruf bei Weber");

  log();
  log("— Worker-Takt zur Erinnerungszeit —");
  await tickWorker("nachweis", erinnerung.runAt);
  const erinnert = (await holeNeueMeldungen(org.id))[0];
  log(`NOVA (Meldung): ${erinnert?.text}`);
  check(Boolean(erinnert) && /^In 15 Minuten: /.test(erinnert!.text) && /weber/i.test(erinnert!.text), "Erinnerung kommt");

  log();
  log("ERGEBNIS: Nachweis Termine bestanden (echte API, Test-Postfach, Kalender im Speicher, Worker-Takt mit fester Zeit).");
  log("Nicht geprüft: echter Kalender (CalDAV), Erinnerung in NOVA.app – das ist Joachims Abnahme.");
  setzeKalender(null);
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    log(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(path.join(process.cwd(), "docs", "nachweis-termine.txt"), `${lines.join("\n")}\n`, "utf8");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
