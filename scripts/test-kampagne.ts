/**
 * Regressionstest Kampagnen (Phase 3) – ohne Apple Mail, ohne Netz, ohne App.
 * Wegwerf-Datenbank und -NOVA_HOME, Test-Postfach, geskriptetes Modell für die Postfach-Wache.
 * Geprüft wird: planen sendet nichts, starten nur mit der eigenen Freigabe, eine Mail pro Work-Item im Abstand,
 * Abbruch stoppt den Rest, Abschluss wird einmal gemeldet, Antworten werden erkannt und als Entwurf vorgelegt.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-kampagne-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.NOVA_HOME = path.join(tmp, "home");

type Postfach = import("@/services/mail/postfach").Postfach;
type MailKopf = import("@/services/mail/postfach").MailKopf;
type MailVoll = import("@/services/mail/postfach").MailVoll;
type HeadProvider = import("@/types/ai").HeadProvider;
type HeadTurnInput = import("@/types/ai").HeadTurnInput;

async function main() {
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { env: process.env, encoding: "utf8" });
  if (push.status !== 0) throw new Error(`Test-Datenbank konnte nicht angelegt werden:\n${push.stderr}`);

  const home = process.env.NOVA_HOME!;
  fs.mkdirSync(path.join(home, "vorlagen"), { recursive: true });
  fs.mkdirSync(path.join(home, "kampagnen"), { recursive: true });
  fs.writeFileSync(
    path.join(home, "vorlagen", "sponsoren.md"),
    "Betreff: Partnerschaft mit {{firma}}\n\n{{anrede}},\n\nfür den Bereich „{{bereich}}“ möchten wir {{firma}} gewinnen.\n",
  );
  fs.writeFileSync(
    path.join(home, "kampagnen", "test.csv"),
    [
      "﻿firma;anrede;email;bereich",
      "Alpha GmbH;Sehr geehrte Frau Alt;a@alpha.de;Versicherungen",
      '"Beta; Söhne";Sehr geehrtes Beta-Team;b@beta.de;Telefonie',
      "Gamma;Sehr geehrter Herr Gamm;c@gamma.de;Software",
      "Kaputt;Hallo;keine-adresse;Egal",
      "Ohne Bereich;Hallo;d@delta.de;",
      "Alpha doppelt;Hallo;a@alpha.de;Versicherungen",
    ].join("\n"),
  );

  const { prisma } = await import("@/lib/prisma");
  const { executeTool } = await import("@/services/tools/registry");
  const { mailSendHandler } = await import("@/services/mail/send-work");
  const { postfachWache } = await import("@/services/kampagnen/wache");
  const { nachNeustart } = await import("@/services/kampagnen");
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  const { encodeMailRef, decodeMailRef } = await import("@/services/mail/postfach");
  const { parseKontaktliste } = await import("@/lib/mail/kontaktlisten");

  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });

  const gesendet: Array<{ art: string; an: string; betreff: string }> = [];
  let scheitertAn: string | null = null;
  let posteingang: Array<MailVoll & { bezuege?: string[]; automatisch?: boolean }> = [];
  const postfach: Postfach = {
    neueste: async (input) => posteingang.slice(0, input.anzahl) as MailKopf[],
    eingang: async (input) =>
      posteingang
        .filter((mail) => new Date(mail.eingang) >= input.seit)
        .map((mail) => ({ ...mail, messageId: (decodeMailRef(mail.ref)?.messageId ?? "").replace(/^<|>$/g, "").toLowerCase(), bezuege: mail.bezuege ?? [], automatisch: mail.automatisch ?? false })),
    lesen: async (ref) => posteingang.find((mail) => mail.ref === ref) ?? null,
    senden: async (input) => {
      if (input.an === scheitertAn) return { ok: false, executed: false, grund: "Adresse abgelehnt." };
      gesendet.push({ art: "senden", an: input.an, betreff: input.betreff });
      return { ok: true, executed: true, messageId: `<${gesendet.length}@test>`, grund: "Im Ordner Gesendet gefunden." };
    },
    antworten: async (input) => {
      gesendet.push({ art: "antworten", an: input.an, betreff: input.betreff });
      return { ok: true, executed: true, messageId: `<r${gesendet.length}@test>`, grund: "Im Ordner Gesendet gefunden." };
    },
  };
  const ctx = { organizationId: org.id, postfach };
  const run = (name: string, args: Record<string, unknown>) => executeTool(name, args, ctx);
  const handler = mailSendHandler(postfach);
  const sendeItem = async (entwurfId: string) =>
    handler({ id: "w", organizationId: org.id, jobId: null, kind: "mail.send", payload: { entwurfId }, attempts: 0 });
  const plane = async () =>
    run("kampagne_planen", { vorlage: "sponsoren", liste: "test", abstand_minuten: 5, absender: "joachim@rankpilot.de" });

  let kampagneId = "";
  const kampagnenStandFuer = async () => (await import("@/services/kampagnen")).kampagnenStand(org.id, kampagneId);
  let freigabeId = "";

  const tests: Array<[string, () => Promise<void>]> = [
    ["Kontaktliste: BOM, Anführungszeichen mit Trenner, Komma-Listen", async () => {
      const semikolon = parseKontaktliste('﻿firma;email\n"A; B";x@y.de\n');
      assert.deepEqual(semikolon, [{ zeile: 2, werte: { firma: "A; B", email: "x@y.de" } }]);
      const komma = parseKontaktliste("Email,Firma\nx@y.de,Z\n\n");
      assert.deepEqual(komma, [{ zeile: 2, werte: { email: "x@y.de", firma: "Z" } }]);
    }],
    ["Planen: gültige Zeilen werden Entwürfe, ungültige mit Grund – gesendet wird nichts", async () => {
      const result = await plane();
      assert.equal(result.ok, true, result.error);
      const data = result.data as {
        kampagne_id: string; freigabe_id: string; anzahl: number; dauer_minuten: number;
        ungueltig: Array<{ firma: string; grund: string }>; beispiel: { betreff: string; text: string };
      };
      kampagneId = data.kampagne_id;
      freigabeId = data.freigabe_id;
      assert.equal(data.anzahl, 3);
      assert.equal(data.dauer_minuten, 10);
      assert.deepEqual(
        data.ungueltig.map((item) => [item.firma, item.grund]),
        [
          ["Kaputt", "keine gültige Mail-Adresse"],
          ["Ohne Bereich", "fehlende Werte: bereich"],
          ["Alpha doppelt", "Adresse doppelt in der Liste"],
        ],
      );
      assert.equal(data.beispiel.betreff, "Partnerschaft mit Alpha GmbH");
      assert.equal(data.beispiel.text, "Sehr geehrte Frau Alt,\n\nfür den Bereich „Versicherungen“ möchten wir Alpha GmbH gewinnen.");
      assert.equal(gesendet.length, 0);
      assert.equal(await prisma.workItem.count({ where: { kind: "mail.send" } }), 0);
      const beta = await prisma.communication.findFirstOrThrow({ where: { campaignId: kampagneId, toAddress: "b@beta.de" } });
      assert.equal(beta.recipientName, "Beta; Söhne");
    }],
    ["Kampagnen-Entwurf lässt sich vor dem Start nicht einzeln senden", async () => {
      const entwurf = await prisma.communication.findFirstOrThrow({ where: { campaignId: kampagneId } });
      const result = await run("mail_senden", { entwurf_id: entwurf.id, freigabe_id: "" });
      assert.equal(result.executed, false);
      assert.match(result.error ?? "", /Kampagne läuft nicht/);
      assert.equal(gesendet.length, 0);
    }],
    ["Starten nur mit der Freigabe dieser Kampagne", async () => {
      const falsch = await run("kampagne_starten", { kampagne_id: kampagneId, freigabe_id: "gibt-es-nicht" });
      assert.equal(falsch.ok, false);
      assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: kampagneId } })).status, "wartet_auf_freigabe");
    }],
    ["Start: eine Mail pro Work-Item, im Abstand von 5 Minuten, Postfach-Wache geplant", async () => {
      const result = await run("kampagne_starten", { kampagne_id: kampagneId, freigabe_id: freigabeId });
      assert.equal(result.ok, true, result.error);
      const items = await prisma.workItem.findMany({ where: { kind: "mail.send" }, orderBy: { runAt: "asc" } });
      assert.equal(items.length, 3);
      assert.equal(items[1]!.runAt.getTime() - items[0]!.runAt.getTime(), 5 * 60_000);
      assert.equal(items[2]!.runAt.getTime() - items[0]!.runAt.getTime(), 10 * 60_000);
      assert.equal(await prisma.workItem.count({ where: { kind: "postfach.wache", status: "queued" } }), 1);
      assert.equal(gesendet.length, 0, "Starten plant nur; senden tut der Hintergrund-Läufer");
    }],
    ["Versand über den Worker; Fehlschlag zählt, Abschluss wird genau einmal gemeldet", async () => {
      const entwuerfe = await prisma.communication.findMany({ where: { campaignId: kampagneId }, orderBy: { createdAt: "asc" } });
      assert.equal((await sendeItem(entwuerfe[0]!.id)).ok, true);
      scheitertAn = "b@beta.de";
      assert.equal((await sendeItem(entwuerfe[1]!.id)).ok, false);
      scheitertAn = null;
      assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: kampagneId } })).status, "laeuft");
      assert.equal((await holeNeueMeldungen(org.id)).length, 0);
      assert.equal((await sendeItem(entwuerfe[2]!.id)).ok, true);
      assert.deepEqual(gesendet.map((mail) => mail.an), ["a@alpha.de", "c@gamma.de"]);
      assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: kampagneId } })).status, "fertig");
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.length, 1);
      assert.match(meldungen[0]!.text, /2 von 3 Mails sind raus, 1 nicht \(Beta; Söhne\)/);
      assert.match(meldungen[0]!.text, /3 Adressen waren ungültig/);
      const { fertigMeldung } = await import("@/services/kampagnen");
      const eins = fertigMeldung({ ...(await kampagnenStandFuer()), ungueltig: [{ zeile: 2, firma: "X", email: "", grund: "keine" }] });
      assert.match(eins, /1 Adresse war ungültig und wurde nicht angeschrieben\./);
      assert.equal((await holeNeueMeldungen(org.id)).length, 0, "Meldung wird nur einmal zugestellt");
      const status = await run("kampagne_status", { kampagne_id: kampagneId });
      const stand = status.data as { gesendet: number; fehlgeschlagen: Array<{ grund: string }> };
      assert.equal(stand.gesendet, 2);
      assert.equal(stand.fehlgeschlagen[0]!.grund, "Adresse abgelehnt.");
    }],
    ["Abbruch: offene Mails gehen nicht mehr raus", async () => {
      const plan = (await plane()).data as { kampagne_id: string; freigabe_id: string };
      await run("kampagne_starten", { kampagne_id: plan.kampagne_id, freigabe_id: plan.freigabe_id });
      const entwuerfe = await prisma.communication.findMany({ where: { campaignId: plan.kampagne_id }, orderBy: { createdAt: "asc" } });
      await sendeItem(entwuerfe[0]!.id);
      const vorher = gesendet.length;
      const abbruch = await run("kampagne_abbrechen", { kampagne_id: plan.kampagne_id });
      assert.equal(abbruch.ok, true, abbruch.error);
      const result = await sendeItem(entwuerfe[1]!.id);
      assert.equal(result.ok, false);
      assert.equal(gesendet.length, vorher);
      const offen = await prisma.workItem.count({
        where: { kind: "mail.send", status: "queued", payload: { in: entwuerfe.map((row) => JSON.stringify({ entwurfId: row.id })) } },
      });
      assert.equal(offen, 0, "geplante Work-Items sind storniert");
      assert.equal((await prisma.campaign.findUniqueOrThrow({ where: { id: plan.kampagne_id } })).status, "abgebrochen");
    }],
    ["Postfach-Wache: Antwort eines Empfängers → Entwurf + Meldung, nichts gesendet, keine Doppelmeldung", async () => {
      const alpha = await prisma.communication.findFirstOrThrow({ where: { campaignId: kampagneId, toAddress: "a@alpha.de" } });
      const ref = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "900", messageId: "<antwort@alpha>" });
      const fremd = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "901", messageId: "<x@fremd>" });
      const spaeter = new Date(alpha.sentAt!.getTime() + 60_000).toISOString();
      posteingang = [
        { ref, konto: "joachim@rankpilot.de", von: "Frau Alt <a@alpha.de>", betreff: "Re: Partnerschaft mit Alpha GmbH", eingang: spaeter, gelesen: false, an: [], cc: [], textanfang: "Klingt gut", text: "Klingt gut, rufen Sie mich an." },
        { ref: fremd, konto: "joachim@rankpilot.de", von: "news@fremd.de", betreff: "Newsletter", eingang: spaeter, gelesen: false, an: [], cc: [], textanfang: "", text: "" },
      ];
      const calls: HeadTurnInput[] = [];
      const kopf: HeadProvider = {
        id: "skript",
        async headTurn(input) {
          calls.push(input);
          if (calls.length === 1) {
            return { responseId: "r1", text: "", model: "m", provider: "skript", toolCalls: [
              { callId: "c1", name: "mail_antworten", arguments: { ref, absender: "", text: "Gern, ich rufe Sie morgen an.", ersetzt: "" } },
            ] };
          }
          return { responseId: "r2", text: "Antwort von Alpha GmbH: Interesse. Mein Vorschlag: Gern, ich rufe Sie morgen an. So senden oder ergänzen?", toolCalls: [], model: "m", provider: "skript" };
        },
        async healthCheck() { return { ok: true, provider: "skript", message: "" }; },
      };
      const vorher = gesendet.length;
      const erste = await postfachWache({ organizationId: org.id, postfach, kopf: { provider: kopf, model: "m" } });
      assert.equal(erste.neueAntworten, 1);
      assert.match(String((calls[0]!.input[0] as { content: string }).content), /^\[Postfach-Wache\] Alpha GmbH/);
      assert.equal(gesendet.length, vorher, "Wache sendet nie");
      const entwurf = await prisma.communication.findFirstOrThrow({ where: { replyRef: ref, direction: "outbound" } });
      assert.equal(entwurf.toAddress, "a@alpha.de");
      assert.equal(entwurf.status, "draft");
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.length, 1);
      assert.match(meldungen[0]!.text, /^Antwort von Alpha GmbH/);
      const gespeichert = await prisma.conversationMessage.findFirstOrThrow({ where: { id: meldungen[0]!.id } });
      assert.match(gespeichert.metadata ?? "", new RegExp(entwurf.id), "Entwurfs-ID geht mit, damit „senden“ klappt");
      const zweite = await postfachWache({ organizationId: org.id, postfach, kopf: { provider: kopf, model: "m" } });
      assert.equal(zweite.neueAntworten, 0);
      assert.equal(calls.length, 2, "gleiche Antwort löst den Kopf nicht erneut aus");
    }],
    ["Postfach-Wache: Antwort über den Mail-Verlauf (Kollege, andere Adresse) wird erkannt, fremde Mails nicht", async () => {
      const alpha = await prisma.communication.findFirstOrThrow({ where: { campaignId: kampagneId, toAddress: "a@alpha.de", direction: "outbound", status: "sent" } });
      assert.ok(alpha.externalReference, "gesendete Kampagnen-Mail trägt ihre Message-ID");
      const kennung = String(alpha.externalReference).replace(/^<|>$/g, "").toLowerCase();
      const spaeter = new Date(Date.now() + 1000).toISOString();
      const kollege = encodeMailRef({ kontoId: "K1", postfach: "Junk", nachrichtId: "910", messageId: "<kollege@beta>" });
      const zufall = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "911", messageId: "<zufall@x>" });
      const eigene = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "912", messageId: "<eigen@x>" });
      posteingang = [
        { ref: kollege, konto: "joachim@rankpilot.de", von: "Chef <chef@alpha-gruppe.de>", betreff: "AW: Partnerschaft", eingang: spaeter, gelesen: false, an: [], cc: [], textanfang: "Ich übernehme", text: "Ich übernehme das.", bezuege: [`${kennung}`, "irgendwas@else"] },
        { ref: zufall, konto: "joachim@rankpilot.de", von: "c@unbekannt.de", betreff: "Re: etwas anderes", eingang: spaeter, gelesen: false, an: [], cc: [], textanfang: "", text: "", bezuege: ["fremd@id"] },
        { ref: eigene, konto: "joachim@rankpilot.de", von: "joachim@rankpilot.de", betreff: "Re: Partnerschaft", eingang: spaeter, gelesen: false, an: [], cc: [], textanfang: "", text: "", bezuege: [kennung] },
      ];
      const aufrufe: string[] = [];
      const kopf: HeadProvider = {
        id: "skript",
        async headTurn(input) {
          aufrufe.push(String((input.input[0] as { content?: string }).content ?? ""));
          return { responseId: "r", text: "Antwort von Alpha: Der Chef übernimmt. So senden oder ergänzen?", toolCalls: [], model: "m", provider: "skript" };
        },
        async healthCheck() { return { ok: true, provider: "skript", message: "" }; },
      };
      const ergebnis = await postfachWache({ organizationId: org.id, postfach, kopf: { provider: kopf, model: "m" } });
      assert.equal(ergebnis.neueAntworten, 1, "nur die Kollegen-Antwort, nicht die fremde und nicht die eigene");
      assert.match(aufrufe[0]!, /^\[Postfach-Wache\] Alpha GmbH.*Absender der Antwort: chef@alpha-gruppe\.de/);
      const eingang = await prisma.communication.findFirstOrThrow({ where: { direction: "inbound", replyRef: kollege } });
      assert.equal(eingang.campaignId, kampagneId);
    }],
    ["Rückläufer: Adresse wird als unzustellbar markiert, gesperrt und gemeldet", async () => {
      const { aufSperrliste } = await import("@/lib/mail/sperrliste");
      const { kampagnenStand } = await import("@/services/kampagnen");
      await holeNeueMeldungen(org.id);
      const ref = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "920", messageId: "<bounce@mx>" });
      posteingang = [{
        ref, konto: "joachim@rankpilot.de", von: "Mail Delivery System <MAILER-DAEMON@mx.ionos.de>", betreff: "Mail delivery failed",
        eingang: new Date(Date.now() + 2000).toISOString(), gelesen: false, an: [], cc: [], textanfang: "This message was created automatically",
        text: "This message was created automatically by mail delivery software.\n\n  c@gamma.de\n    host mx.gamma.de: 550 5.1.1 User unknown",
      }];
      const kopf: HeadProvider = {
        id: "skript",
        async headTurn() { throw new Error("Rückläufer braucht den Kopf nicht"); },
        async healthCheck() { return { ok: true, provider: "skript", message: "" }; },
      };
      const ergebnis = await postfachWache({ organizationId: org.id, postfach, kopf: { provider: kopf, model: "m" } });
      assert.equal(ergebnis.neueAntworten, 0, "ein Rückläufer ist keine Antwort");
      const gamma = await prisma.communication.findFirstOrThrow({ where: { campaignId: kampagneId, toAddress: "c@gamma.de", direction: "outbound" } });
      assert.equal(gamma.deliveryStatus, "BOUNCED");
      assert.equal(aufSperrliste("c@gamma.de"), true);
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.length, 1);
      assert.match(meldungen[0]!.text, /unzustellbar zurück: Gamma \(c@gamma\.de\)\. Die Adresse habe ich gesperrt\./);
      assert.deepEqual((await kampagnenStand(org.id, kampagneId)).unzustellbar, [{ firma: "Gamma", email: "c@gamma.de" }]);
      await postfachWache({ organizationId: org.id, postfach, kopf: { provider: kopf, model: "m" } });
      assert.equal((await holeNeueMeldungen(org.id)).length, 0, "derselbe Rückläufer wird nicht doppelt gemeldet");
    }],
    ["Abwesenheitsnotiz wird festgehalten, aber nicht vorgelegt", async () => {
      await holeNeueMeldungen(org.id);
      const ref = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "930", messageId: "<ooo@alpha>" });
      posteingang = [{
        ref, konto: "joachim@rankpilot.de", von: "a@alpha.de", betreff: "Abwesend: Partnerschaft", eingang: new Date(Date.now() + 3000).toISOString(),
        gelesen: false, an: [], cc: [], textanfang: "Ich bin bis 10.10. nicht im Büro.", text: "Ich bin bis 10.10. nicht im Büro.", automatisch: true,
      }];
      const kopf: HeadProvider = {
        id: "skript",
        async headTurn() { throw new Error("Abwesenheitsnotiz braucht den Kopf nicht"); },
        async healthCheck() { return { ok: true, provider: "skript", message: "" }; },
      };
      const ergebnis = await postfachWache({ organizationId: org.id, postfach, kopf: { provider: kopf, model: "m" } });
      assert.equal(ergebnis.neueAntworten, 0);
      assert.equal((await prisma.communication.findFirstOrThrow({ where: { replyRef: ref, direction: "inbound" } })).status, "autoreply");
      assert.equal((await holeNeueMeldungen(org.id)).length, 0);
    }],
    ["Absage → Sperrliste über den Kopf; geplante Mail an diese Adresse geht nicht raus, neue Kampagne überspringt sie", async () => {
      const { sperrlisteDatei } = await import("@/lib/mail/sperrliste");
      // Zweite Kampagne vor der Absage: Gamma ist nach dem Rückläufer schon gesperrt.
      const plan = (await plane()).data as { kampagne_id: string; freigabe_id: string; ungueltig: Array<{ firma: string; grund: string }> };
      assert.ok(plan.ungueltig.some((item) => item.firma === "Gamma" && item.grund === "steht auf der Sperrliste"));
      await run("kampagne_starten", { kampagne_id: plan.kampagne_id, freigabe_id: plan.freigabe_id });
      const alphaNeu = await prisma.communication.findFirstOrThrow({ where: { campaignId: plan.kampagne_id, toAddress: "a@alpha.de" } });

      await holeNeueMeldungen(org.id);
      const ref = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "940", messageId: "<absage@alpha>" });
      posteingang = [{
        ref, konto: "joachim@rankpilot.de", von: "a@alpha.de", betreff: "Re: Partnerschaft", eingang: new Date(Date.now() + 4000).toISOString(),
        gelesen: false, an: [], cc: [], textanfang: "Kein Interesse", text: "Kein Interesse, bitte keine weiteren Mails.",
      }];
      const auftraege: string[] = [];
      let runde = 0;
      const kopf: HeadProvider = {
        id: "skript",
        async headTurn(input) {
          runde += 1;
          if (runde === 1) {
            auftraege.push(String((input.input[0] as { content?: string }).content ?? ""));
            return { responseId: "r1", text: "", model: "m", provider: "skript", toolCalls: [
              { callId: "s1", name: "sperrliste_hinzufuegen", arguments: { eintrag: "a@alpha.de", grund: "Absage" } },
            ] };
          }
          return { responseId: "r2", text: "Alpha GmbH hat abgesagt und wird nicht mehr angeschrieben.", toolCalls: [], model: "m", provider: "skript" };
        },
        async healthCheck() { return { ok: true, provider: "skript", message: "" }; },
      };
      const vorher = gesendet.length;
      const ergebnis = await postfachWache({ organizationId: org.id, postfach, kopf: { provider: kopf, model: "m" } });
      assert.equal(ergebnis.neueAntworten, 1);
      assert.match(auftraege[0]!, /Absage .* sperrliste_hinzufuegen/);
      assert.equal(await prisma.communication.count({ where: { replyRef: ref, direction: "outbound" } }), 0, "kein Entwurf bei Absage");
      assert.match((await holeNeueMeldungen(org.id))[0]!.text, /abgesagt/);

      const versuch = await sendeItem(alphaNeu.id);
      assert.equal(versuch.ok, false);
      assert.match(versuch.note ?? "", /Sperrliste/);
      assert.equal(gesendet.length, vorher, "gesperrte Adresse bekommt keine Kampagnen-Mail mehr");
      assert.equal((await prisma.communication.findUniqueOrThrow({ where: { id: alphaNeu.id } })).status, "cancelled");

      await run("kampagne_abbrechen", { kampagne_id: plan.kampagne_id });
      fs.rmSync(sperrlisteDatei());
      posteingang = [];
      await holeNeueMeldungen(org.id);
    }],
    ["Postfach-Wache bleibt geplant, auch wenn Apple Mail nicht antwortet", async () => {
      await prisma.workItem.deleteMany({ where: { kind: "postfach.wache" } });
      const kaputt: typeof postfach = { ...postfach, eingang: async () => { throw new Error("Mail antwortet nicht"); } };
      const kopf: HeadProvider = {
        id: "skript",
        async headTurn() { throw new Error("darf nicht laufen"); },
        async healthCheck() { return { ok: true, provider: "skript", message: "" }; },
      };
      await assert.rejects(postfachWache({ organizationId: org.id, postfach: kaputt, kopf: { provider: kopf, model: "m" } }), /Mail antwortet nicht/);
      assert.equal(await prisma.workItem.count({ where: { kind: "postfach.wache", status: "queued" } }), 1);
    }],
    ["Neustart: laufende Kampagne wird gemeldet, nicht doppelt", async () => {
      const plan = (await plane()).data as { kampagne_id: string; freigabe_id: string };
      await run("kampagne_starten", { kampagne_id: plan.kampagne_id, freigabe_id: plan.freigabe_id });
      await holeNeueMeldungen(org.id);
      assert.equal(await nachNeustart(), 1);
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.length, 1);
      assert.match(meldungen[0]!.text, /^Nach dem Neustart läuft die Kampagne .* weiter: 0 von 3 Mails sind raus, 3 folgen\.$/);
      await nachNeustart();
      assert.equal((await holeNeueMeldungen(org.id)).length, 0);
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
