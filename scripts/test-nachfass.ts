/**
 * Regressionstest Nachfass-Mail – ohne Apple Mail, ohne Netz, ohne App.
 * Wegwerf-Datenbank und -NOVA_HOME, Test-Postfach.
 * Geprüft wird: Nachfass steht in Plan und Freigabe, geht nur an Empfänger ohne Antwort, nicht an Gesperrte,
 * nur einmal, nur werktags im Zeitfenster, entfällt bei einer Antwort vor dem Versand und zählt getrennt.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wegwerfDatenbank } from "./lib/wegwerf-db";

// Deutsche Zeit wie auf dem Server (pm2: TZ=Europe/Berlin), unabhängig vom Rechner, auf dem der Test läuft.
process.env.TZ = "Europe/Berlin";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-nachfass-"));
process.env.NOVA_HOME = path.join(tmp, "home");

type Postfach = import("@/services/mail/postfach").Postfach;

async function main() {
  wegwerfDatenbank();

  const home = process.env.NOVA_HOME!;
  fs.mkdirSync(path.join(home, "vorlagen"), { recursive: true });
  fs.mkdirSync(path.join(home, "kampagnen"), { recursive: true });
  fs.writeFileSync(path.join(home, "vorlagen", "kunden.md"), "Betreff: Frage an {{firma}}\n\n{{anrede}},\n\nerste Mail an {{firma}}.\n");
  fs.writeFileSync(path.join(home, "vorlagen", "kunden-nachfass.md"), "Betreff: Kurz nachgefragt: {{firma}}\n\n{{anrede}},\n\nnoch einmal kurz zu {{firma}}.\n");
  fs.writeFileSync(path.join(home, "vorlagen", "sponsoren.md"), "Betreff: Partner {{firma}}\n\n{{anrede}},\n\nText.\n");
  fs.writeFileSync(
    path.join(home, "kampagnen", "liste.csv"),
    ["firma;anrede;email", "Antwortet;Guten Tag A;a@a.de", "Gesperrt;Guten Tag B;b@b.de", "Still;Guten Tag C;c@c.de", "Spaet;Guten Tag D;d@d.de", "Zurueck;Guten Tag E;e@e.de"].join("\n"),
  );

  const { prisma } = await import("@/lib/prisma");
  const { executeTool } = await import("@/services/tools/registry");
  const { mailSendHandler } = await import("@/services/mail/send-work");
  const { nachfassTick } = await import("@/services/nachfass");
  const { kampagnenStand } = await import("@/services/kampagnen");
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  const { sperre } = await import("@/lib/mail/sperrliste");

  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });
  const gesendet: Array<{ an: string; betreff: string; text: string }> = [];
  const postfach: Postfach = {
    neueste: async () => [],
    eingang: async () => [],
    lesen: async () => null,
    senden: async (input) => {
      gesendet.push({ an: input.an, betreff: input.betreff, text: input.text });
      return { ok: true, executed: true, messageId: `<${gesendet.length}@test>`, grund: "Test-Postfach." };
    },
    antworten: async () => ({ ok: false, executed: false, grund: "nicht im Test" }),
  };
  const ctx = { organizationId: org.id, postfach };
  const run = (name: string, args: Record<string, unknown>) => executeTool(name, args, ctx);
  const handler = mailSendHandler(postfach);
  const sendeItem = (entwurfId: string) =>
    handler({ id: "w", organizationId: org.id, jobId: null, kind: "mail.send", payload: { entwurfId }, attempts: 0 });

  // Mittwoch 10:00 Ortszeit – im Zeitfenster des Tagesbetriebs (Mo–Fr, 08–17 Uhr).
  const mittwoch = new Date(2026, 9, 7, 10, 0, 0);
  const vorSiebenTagen = new Date(mittwoch.getTime() - 7 * 86_400_000);
  let kampagneId = "";

  const tests: Array<[string, () => Promise<void>]> = [
    ["Plan und Freigabe nennen die Nachfass-Mail; ohne Nachfass-Vorlage gibt es keine", async () => {
      const ohne = await run("kampagne_planen", { vorlage: "sponsoren", liste: "liste", abstand_minuten: 5, absender: "joachim@rankpilot.de", nachfass_tage: -1 });
      assert.equal((ohne.data as { nachfass: unknown }).nachfass, "keine Nachfass-Mail");
      const falsch = await run("kampagne_planen", { vorlage: "sponsoren", liste: "liste", abstand_minuten: 5, absender: "joachim@rankpilot.de", nachfass_tage: 5 });
      assert.equal(falsch.ok, false);
      assert.match(falsch.error ?? "", /Vorlage „sponsoren-nachfass“/);

      const plan = await run("kampagne_planen", { vorlage: "kunden", liste: "liste", abstand_minuten: 5, absender: "joachim@rankpilot.de", nachfass_tage: -1 });
      assert.equal(plan.ok, true, plan.error);
      const data = plan.data as { kampagne_id: string; freigabe_id: string; nachfass: { nach_tagen: number; vorlage: string } };
      assert.deepEqual({ tage: data.nachfass.nach_tagen, vorlage: data.nachfass.vorlage }, { tage: 6, vorlage: "kunden-nachfass" });
      const freigabe = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: data.freigabe_id } });
      assert.match(freigabe.description, /nach 6 Tagen nicht geantwortet hat, bekommt eine Nachfass-Mail/);
      kampagneId = data.kampagne_id;
      const start = await run("kampagne_starten", { kampagne_id: kampagneId, freigabe_id: data.freigabe_id });
      assert.equal(start.ok, true, start.error);
      assert.equal(await prisma.workItem.count({ where: { kind: "nachfass.tick" } }), 1, "Nachfass-Takt ist geplant");
    }],
    ["Erste Runde geht raus; Antwort, Sperrliste und Rückläufer schließen die Nachfass-Mail aus", async () => {
      const entwuerfe = await prisma.communication.findMany({ where: { campaignId: kampagneId }, orderBy: { createdAt: "asc" } });
      for (const entwurf of entwuerfe) assert.equal((await sendeItem(entwurf.id)).ok, true);
      assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: kampagneId } })).status, "fertig");
      // Die erste Runde liegt sieben Tage zurück.
      await prisma.communication.updateMany({ where: { campaignId: kampagneId }, data: { sentAt: vorSiebenTagen } });
      await prisma.campaign.update({ where: { id: kampagneId }, data: { startedAt: vorSiebenTagen } });
      // A hat geantwortet (über einen Kollegen, gleiche Firma), B ist gesperrt.
      await prisma.communication.create({
        data: {
          organizationId: org.id, channel: "email", direction: "inbound", subject: "Re: Frage", body: "Gern",
          status: "received", fromAddress: "chef@a-gruppe.de", campaignId: kampagneId, recipientName: "Antwortet",
        },
      });
      sperre("b@b.de", "Absage");
      // E kam als unzustellbar zurück.
      await prisma.communication.updateMany({ where: { campaignId: kampagneId, toAddress: "e@e.de" }, data: { deliveryStatus: "BOUNCED" } });
      await holeNeueMeldungen(org.id);

      const samstag = new Date(2026, 9, 10, 10, 0, 0);
      const amWochenende = await nachfassTick({ organizationId: org.id, jetzt: samstag });
      assert.deepEqual(amWochenende, { angelegt: 0, weiter: true }, "am Wochenende wird nicht nachgefasst");

      const vorher = gesendet.length;
      const lauf = await nachfassTick({ organizationId: org.id, jetzt: mittwoch });
      assert.equal(lauf.angelegt, 2, "nur C und D");
      assert.equal(gesendet.length, vorher, "der Takt sendet nicht selbst");
      const nachfass = await prisma.communication.findMany({ where: { nachfassZu: { not: null } }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(nachfass.map((row) => row.toAddress), ["c@c.de", "d@d.de"]);
      assert.equal(nachfass[0]!.subject, "Kurz nachgefragt: Still");
      assert.equal(nachfass[0]!.body, "Guten Tag C,\n\nnoch einmal kurz zu Still.");
      const items = await prisma.workItem.findMany({ where: { kind: "mail.send", payload: { in: nachfass.map((row) => JSON.stringify({ entwurfId: row.id })) } }, orderBy: { runAt: "asc" } });
      assert.equal(items.length, 2);
      assert.equal(items[1]!.runAt.getTime() - items[0]!.runAt.getTime(), 5 * 60_000, "im Abstand der Kampagne");
      const meldungen = await holeNeueMeldungen(org.id);
      assert.match(meldungen[0]!.text, /Ich fasse bei 2 Betrieben nach, die noch nicht geantwortet haben: Still, Spaet\./);

      const nochmal = await nachfassTick({ organizationId: org.id, jetzt: new Date(mittwoch.getTime() + 30 * 60_000) });
      assert.equal(nochmal.angelegt, 0, "jede Firma bekommt höchstens eine Nachfass-Mail");
    }],
    ["Versand: Nachfass geht trotz fertiger Kampagne raus; kommt vorher eine Antwort, entfällt sie", async () => {
      const [c, d] = await prisma.communication.findMany({ where: { nachfassZu: { not: null } }, orderBy: { createdAt: "asc" } });
      assert.equal((await sendeItem(c!.id)).ok, true);
      assert.equal(gesendet.at(-1)!.an, "c@c.de");

      await prisma.communication.create({
        data: {
          organizationId: org.id, channel: "email", direction: "inbound", subject: "Re: Frage", body: "Ja bitte",
          status: "received", fromAddress: "d@d.de", campaignId: kampagneId, recipientName: "Spaet",
        },
      });
      const vorher = gesendet.length;
      const versuch = await sendeItem(d!.id);
      assert.equal(versuch.ok, false);
      assert.match(versuch.note ?? "", /Inzwischen kam eine Antwort/);
      assert.equal(gesendet.length, vorher);
      assert.equal((await prisma.communication.findUniqueOrThrow({ where: { id: d!.id } })).status, "cancelled");
    }],
    ["Tagesbetrieb-Einstellung: mit Nachfass-Vorlage an, ohne Vorlage still aus (kein Abbruch)", async () => {
      const { nachfassEinstellung } = await import("@/services/kampagnen");
      assert.deepEqual(nachfassEinstellung("kunden", 6, false), { tage: 6, vorlage: "kunden-nachfass" });
      assert.equal(nachfassEinstellung("sponsoren", 6, false), null);
      assert.throws(() => nachfassEinstellung("sponsoren", 6), /fehlt die Vorlage/);
      assert.equal(nachfassEinstellung("kunden", 0, false), null);
    }],
    ["Kampagnenstand zählt erste Mails und Nachfass getrennt", async () => {
      const stand = await kampagnenStand(org.id, kampagneId);
      assert.equal(stand.gesamt, 5);
      assert.equal(stand.gesendet, 5);
      assert.deepEqual(stand.nachfass, { nach_tagen: 6, vorlage: "kunden-nachfass", gesendet: 1, geplant: 0 });
    }],
    ["Abgebrochene Kampagne und zu alte Mails: kein Nachfassen, Takt endet", async () => {
      await prisma.campaign.update({ where: { id: kampagneId }, data: { status: "abgebrochen" } });
      const lauf = await nachfassTick({ organizationId: org.id, jetzt: mittwoch });
      assert.deepEqual(lauf, { angelegt: 0, weiter: false });
    }],
  ];

  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}`);
      console.log(error instanceof Error ? error.message : error);
    }
  }
  await prisma.$disconnect();
  console.log(failed ? `${failed} von ${tests.length} fehlgeschlagen` : `alle ${tests.length} bestanden`);
  return failed;
}

main()
  .then((failed) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  })
  .catch((error) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.error(error);
    process.exit(1);
  });
