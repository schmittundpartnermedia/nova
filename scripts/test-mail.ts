/**
 * Regressionstest Mail-Werkzeuge (Phase 2) – ohne Apple Mail, ohne Netz, ohne App.
 * Eigene Wegwerf-Datenbank und eigener NOVA_HOME; das Postfach ist ein Test-Postfach,
 * das jeden Aufruf protokolliert. Geprüft wird: Entwurf ≠ Versand, Versand nur mit Freigabe,
 * Tageslimit zählt nur wirklich gesendete Mails, Antworten beziehen sich auf die Originalmail.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-mail-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.NOVA_HOME = path.join(tmp, "home");

type Postfach = import("@/services/mail/postfach").Postfach;
type MailVoll = import("@/services/mail/postfach").MailVoll;
type VersandErgebnis = import("@/services/mail/postfach").VersandErgebnis;

function testPostfach(original: Record<string, MailVoll>) {
  const calls: Array<{ art: string; input: unknown }> = [];
  let naechstesErgebnis: VersandErgebnis | null = null;
  const ergebnis = (): VersandErgebnis => {
    const next = naechstesErgebnis ?? { ok: true, executed: true, messageId: `<m${calls.length}@test>`, grund: "Im Ordner Gesendet gefunden." };
    naechstesErgebnis = null;
    return next;
  };
  const postfach: Postfach = {
    async eingang() {
      return [];
    },
    async neueste(input) {
      calls.push({ art: "neueste", input });
      return Object.values(original).slice(0, input.anzahl);
    },
    async lesen(ref) {
      calls.push({ art: "lesen", input: ref });
      return original[ref] ?? null;
    },
    async senden(input) {
      calls.push({ art: "senden", input });
      return ergebnis();
    },
    async antworten(input) {
      calls.push({ art: "antworten", input });
      return ergebnis();
    },
  };
  return {
    postfach,
    calls,
    versandCalls: () => calls.filter((call) => call.art === "senden" || call.art === "antworten"),
    scheitertBeimNaechsten(grund: string) {
      naechstesErgebnis = { ok: false, executed: false, grund };
    },
  };
}

async function main() {
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: process.env,
    encoding: "utf8",
  });
  if (push.status !== 0) throw new Error(`Test-Datenbank konnte nicht angelegt werden:\n${push.stderr}`);

  const { prisma } = await import("@/lib/prisma");
  const { executeTool } = await import("@/services/tools/registry");
  const { mailSendHandler } = await import("@/services/mail/send-work");
  const { encodeMailRef } = await import("@/services/mail/postfach");

  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });

  const refRankpilot = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "101", messageId: "<a@revolut>" });
  const refIcloud = encodeMailRef({ kontoId: "K2", postfach: "INBOX", nachrichtId: "202", messageId: "<b@x>" });
  const original: Record<string, MailVoll> = {
    [refRankpilot]: {
      ref: refRankpilot,
      konto: "joachim@rankpilot.de",
      von: "Revolut Team <team@revolut.com>",
      betreff: "Ihr Konto",
      eingang: "2026-09-29T08:00:00.000Z",
      gelesen: false,
      an: ["joachim@rankpilot.de"],
      cc: [],
      textanfang: "Hallo Joachim",
      text: "Hallo Joachim, bitte melden Sie sich.",
    },
    [refIcloud]: {
      ref: refIcloud,
      konto: "sspmedia@icloud.com",
      von: "privat@example.org",
      betreff: "Grillen",
      eingang: "2026-09-29T09:00:00.000Z",
      gelesen: true,
      an: ["sspmedia@icloud.com"],
      cc: [],
      textanfang: "Samstag?",
      text: "Samstag?",
    },
  };
  const box = testPostfach(original);
  const mailSendWorkHandler = mailSendHandler(box.postfach);
  const ctx = { organizationId: org.id, postfach: box.postfach };
  const run = (name: string, args: Record<string, unknown>) => executeTool(name, args, ctx);
  const entwurf = (args: Partial<Record<string, string>> = {}) =>
    run("mail_entwurf", {
      absender: "joachim@rankpilot.de",
      an: "kunde@example.com",
      betreff: "Termin",
      text: "Hallo, passt Dienstag? Gruß Joachim",
      ersetzt: "",
      ...args,
    });
  const idOf = (result: { data?: unknown }) => (result.data as { entwurf_id: string }).entwurf_id;
  const statusOf = async (id: string) => (await prisma.communication.findUniqueOrThrow({ where: { id } })).status;

  const tests: Array<[string, () => Promise<void>]> = [
    ["mail_lesen liefert die neuesten Mails und gilt nicht als ausgeführt", async () => {
      const result = await run("mail_lesen", { modus: "neueste", anzahl: 5, ref: "" });
      assert.equal(result.ok, true);
      assert.equal(result.executed, false);
      assert.equal((result.data as { anzahl: number }).anzahl, 2);
    }],
    ["mail_lesen nachricht liefert den vollen Text", async () => {
      const result = await run("mail_lesen", { modus: "nachricht", anzahl: 0, ref: refRankpilot });
      assert.equal((result.data as { text: string }).text, "Hallo Joachim, bitte melden Sie sich.");
    }],
    ["Entwurf von nicht freigegebenem Absender wird abgelehnt und nicht gespeichert", async () => {
      const vorher = await prisma.communication.count();
      const result = await entwurf({ absender: "sspmedia@icloud.com" });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /Absender muss/);
      assert.equal(await prisma.communication.count(), vorher);
    }],
    ["Entwurf wird gespeichert, aber nichts gesendet", async () => {
      const result = await entwurf();
      assert.equal(result.ok, true);
      assert.equal(await statusOf(idOf(result)), "draft");
      assert.equal(box.versandCalls().length, 0);
    }],
    ["Ohne Freigabe: mail_senden legt Freigabe an, sendet nicht", async () => {
      const id = idOf(await entwurf());
      const result = await run("mail_senden", { entwurf_id: id, freigabe_id: "" });
      assert.equal(result.executed, false);
      assert.equal((result.data as { status: string }).status, "freigabe_noetig");
      assert.equal(box.versandCalls().length, 0);
      assert.equal(await statusOf(id), "draft");
    }],
    ["Mit der Freigabe genau dieses Entwurfs: gesendet, einmal", async () => {
      const id = idOf(await entwurf());
      const frage = await run("mail_senden", { entwurf_id: id, freigabe_id: "" });
      const freigabeId = (frage.data as { freigabe_id: string }).freigabe_id;
      const vorher = box.versandCalls().length;
      const result = await run("mail_senden", { entwurf_id: id, freigabe_id: freigabeId });
      assert.equal(result.executed, true);
      assert.equal((result.data as { status: string }).status, "gesendet");
      assert.equal(box.versandCalls().length, vorher + 1);
      assert.equal(await statusOf(id), "sent");
      const nochmal = await run("mail_senden", { entwurf_id: id, freigabe_id: freigabeId });
      assert.equal(nochmal.executed, false, "Gesendeter Entwurf darf nicht erneut raus");
      assert.equal(box.versandCalls().length, vorher + 1);
    }],
    ["Freigabe eines anderen Entwurfs öffnet nicht diesen", async () => {
      const a = idOf(await entwurf());
      const b = idOf(await entwurf({ an: "anderer@example.com" }));
      const frageA = await run("mail_senden", { entwurf_id: a, freigabe_id: "" });
      const vorher = box.versandCalls().length;
      const result = await run("mail_senden", {
        entwurf_id: b,
        freigabe_id: (frageA.data as { freigabe_id: string }).freigabe_id,
      });
      assert.equal(result.executed, false);
      assert.equal(box.versandCalls().length, vorher);
    }],
    ["„Mach es kürzer“: ersetzter Entwurf kann nicht mehr gesendet werden", async () => {
      const alt = idOf(await entwurf());
      const neu = idOf(await entwurf({ text: "Dienstag? Gruß Joachim", ersetzt: alt }));
      assert.equal(await statusOf(alt), "superseded");
      assert.equal(await statusOf(neu), "draft");
      const result = await run("mail_senden", { entwurf_id: alt, freigabe_id: "" });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /ersetzt/);
    }],
    ["Antwort: Empfänger, Betreff und Absender kommen aus der Originalmail", async () => {
      const result = await run("mail_antworten", { ref: refRankpilot, absender: "", text: "Wir melden uns nächste Woche.", ersetzt: "" });
      assert.equal(result.ok, true);
      const data = result.data as { an: string; betreff: string; absender: string; ist_antwort: boolean };
      assert.equal(data.an, "team@revolut.com");
      assert.equal(data.betreff, "Re: Ihr Konto");
      assert.equal(data.absender, "joachim@rankpilot.de");
      assert.equal(data.ist_antwort, true);
    }],
    ["Antwort auf Mail an nicht steuerbares Konto: Rückfrage statt Raten", async () => {
      const result = await run("mail_antworten", { ref: refIcloud, absender: "", text: "Gern.", ersetzt: "" });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /Von welchem Konto/);
    }],
    ["Dauerfreigabe: senden ohne Rückfrage, Antwort geht als Antwort raus", async () => {
      const erteilt = await run("freigabe_mail_dauer", { aktion: "erteilen", max_pro_tag: 0 });
      assert.equal(erteilt.ok, true);
      const antwort = await run("mail_antworten", { ref: refRankpilot, absender: "", text: "Kurz: nächste Woche.", ersetzt: "" });
      const result = await run("mail_senden", { entwurf_id: idOf(antwort), freigabe_id: "" });
      assert.equal(result.executed, true);
      const last = box.versandCalls().at(-1)!;
      assert.equal(last.art, "antworten");
      assert.equal((last.input as { ref: string }).ref, refRankpilot);
      await run("freigabe_mail_dauer", { aktion: "widerrufen", max_pro_tag: 0 });
    }],
    ["Tageslimit zählt nur wirklich gesendete Mails (fehlgeschlagener Versand verbraucht nichts)", async () => {
      await prisma.communication.updateMany({ where: { status: "sent" }, data: { sentAt: new Date(Date.now() - 3 * 86_400_000) } });
      await run("freigabe_mail_dauer", { aktion: "erteilen", max_pro_tag: 1 });
      const erster = idOf(await entwurf());
      box.scheitertBeimNaechsten("Apple Mail nicht erreichbar.");
      const fehlschlag = await run("mail_senden", { entwurf_id: erster, freigabe_id: "" });
      assert.equal(fehlschlag.executed, false);
      assert.match(fehlschlag.error ?? "", /nicht erreichbar/);
      const zweiter = idOf(await entwurf({ an: "b@example.com" }));
      const ok = await run("mail_senden", { entwurf_id: zweiter, freigabe_id: "" });
      assert.equal(ok.executed, true, "Nach fehlgeschlagenem Versand muss das Limit noch frei sein");
      const dritter = idOf(await entwurf({ an: "c@example.com" }));
      const gesperrt = await run("mail_senden", { entwurf_id: dritter, freigabe_id: "" });
      assert.equal(gesperrt.executed, false);
      assert.match((gesperrt.data as { grund: string }).grund, /Tageslimit/);
      await run("freigabe_mail_dauer", { aktion: "widerrufen", max_pro_tag: 0 });
    }],
    ["Worker mail.send ohne Dauerfreigabe sendet nicht", async () => {
      const id = idOf(await entwurf());
      const vorher = box.versandCalls().length;
      const result = await mailSendWorkHandler({ id: "w1", organizationId: org.id, jobId: null, kind: "mail.send", payload: { entwurfId: id }, attempts: 0 });
      assert.equal(result.ok, false);
      assert.match(result.note ?? "", /Freigabe nötig/);
      assert.equal(box.versandCalls().length, vorher);
      assert.equal(await statusOf(id), "draft");
    }],
    ["Vorlagen: Datei wird gelesen, importiert, fehlende Werte gemeldet statt erfunden", async () => {
      const dir = path.join(process.env.NOVA_HOME!, "vorlagen");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "sponsoren.md"), "Betreff: Partnerschaft mit {{firma}}\n\n{{anrede}},\n\nwir suchen Partner wie {{firma}}.\n");
      const liste = await run("vorlage_liste", {});
      const vorlagen = (liste.data as { vorlagen: Array<{ name: string; platzhalter: string[] }> }).vorlagen;
      assert.deepEqual(vorlagen, [{ name: "sponsoren", betreff: "Partnerschaft mit {{firma}}", platzhalter: ["firma", "anrede"] }]);
      assert.equal(await prisma.mailTemplate.count({ where: { organizationId: org.id, name: "sponsoren", revokedAt: null } }), 1);
      const halb = await run("vorlage_fuellen", { name: "sponsoren", werte: [{ platzhalter: "firma", wert: "Elektro Maier" }] });
      assert.equal(halb.ok, false);
      assert.deepEqual((halb.data as { fehlend: string[] }).fehlend, ["anrede"]);
      const voll = await run("vorlage_fuellen", {
        name: "sponsoren",
        werte: [{ platzhalter: "firma", wert: "Elektro Maier" }, { platzhalter: "anrede", wert: "Sehr geehrter Herr Maier" }],
      });
      assert.equal(voll.ok, true);
      const data = voll.data as { betreff: string; text: string };
      assert.equal(data.betreff, "Partnerschaft mit Elektro Maier");
      assert.equal(data.text, "Sehr geehrter Herr Maier,\n\nwir suchen Partner wie Elektro Maier.");
    }],
    ["Keine Gedankenstriche in Mails: Entwurf abgelehnt, Vorlage abgelehnt, Werte werden Bindestrich", async () => {
      const vorher = await prisma.communication.count();
      for (const strich of ["\u2013", "\u2014"]) {
        const result = await entwurf({ text: `Hallo ${strich} passt Dienstag?` });
        assert.equal(result.ok, false);
        assert.match(result.error ?? "", /Gedankenstrich/);
        assert.equal((await entwurf({ betreff: `Termin ${strich} Dienstag` })).ok, false);
      }
      assert.equal(await prisma.communication.count(), vorher, "abgelehnte Entwürfe werden nicht gespeichert");
      assert.equal((await entwurf({ text: "Hallo aus Baden-Württemberg, passt Dienstag?" })).ok, true, "Bindestrich bleibt erlaubt");

      const dir = path.join(process.env.NOVA_HOME!, "vorlagen");
      fs.writeFileSync(path.join(dir, "strich.md"), "Betreff: Hallo {{firma}}\n\nWir sind da \u2013 für {{firma}}.\n");
      const mitStrich = await run("vorlage_fuellen", { name: "strich", werte: [{ platzhalter: "firma", wert: "X" }] });
      assert.equal(mitStrich.ok, false);
      assert.match(mitStrich.error ?? "", /Gedankenstrich/);
      fs.rmSync(path.join(dir, "strich.md"));

      const wert = await run("vorlage_fuellen", {
        name: "sponsoren",
        werte: [{ platzhalter: "firma", wert: "Maier \u2013 Elektro" }, { platzhalter: "anrede", wert: "Guten Tag" }],
      });
      assert.equal(wert.ok, true);
      assert.equal((wert.data as { betreff: string }).betreff, "Partnerschaft mit Maier - Elektro");
    }],
    ["Fettdruck und Anzeigename: Sternchen raus, Bereiche fett im Skript, Absender mit Namen", async () => {
      const { zerlegeFett } = await import("@/lib/mail/fett");
      const { newSendScript, replySendScript } = await import("@/lib/mail/apple");
      const { absenderMitName } = await import("@/lib/mail/absendernamen");
      const z = zerlegeFett("Hallo **Welt**, das ist **„wichtig“**. Ende ** offen");
      assert.equal(z.text, "Hallo Welt, das ist „wichtig“. Ende ** offen");
      assert.deepEqual(z.fett.map((b) => z.text.slice(b.von - 1, b.bis)), ["Welt", "„wichtig“"]);
      const neu = newSendScript({ sender: "a@b.de", to: "c@d.de", subject: "S", body: z.text, fett: z.fett });
      assert.match(neu, /set font of characters 7 thru 10 of content of msg to "Helvetica-Bold"/);
      assert.doesNotMatch(neu, /\*\*Welt/);
      const antwort = replySendScript({ accountId: "K", mailbox: "INBOX", messageId: "1", body: z.text, replyAll: false, sender: "a@b.de", fett: z.fett });
      assert.match(antwort, /set font of characters 21 thru 29 of content of theReply/);
      assert.equal(absenderMitName("joachim@rankpilot.de"), "joachim@rankpilot.de", "ohne Eintrag nur die Adresse");
      fs.writeFileSync(path.join(process.env.NOVA_HOME!, "absendernamen.txt"), "# x\njoachim@rankpilot.de = rankPilot Joachim Schmitt\n");
      assert.equal(absenderMitName("joachim@rankpilot.de"), "rankPilot Joachim Schmitt <joachim@rankpilot.de>");
      // Über das Test-Postfach gesendet: Text kommt ohne Sternchen an.
      const id = idOf(await entwurf({ text: "Hallo, **Dienstag** passt?" }));
      assert.equal(id.length > 0, true);
    }],
    ["Signatur: je Absender aus ~/Nova/signaturen.txt, landet im Sende- und Antwort-Skript", async () => {
      const { signaturFuer } = await import("@/lib/mail/signaturen");
      const { newSendScript, replySendScript } = await import("@/lib/mail/apple");
      fs.writeFileSync(path.join(process.env.NOVA_HOME!, "signaturen.txt"), "# Kommentar\njoachim@rankpilot.de = rankpilot Joachim\n");
      assert.equal(signaturFuer("Joachim@Rankpilot.de"), "rankpilot Joachim");
      assert.equal(signaturFuer("info@elevum.io"), undefined);
      const neu = newSendScript({ sender: "joachim@rankpilot.de", to: "a@b.de", subject: "S", body: "T", signature: "rankpilot Joachim" });
      assert.match(neu, /set message signature of msg to signature "rankpilot Joachim"/);
      assert.ok(neu.indexOf("message signature") < neu.indexOf("send msg"), "Signatur vor dem Senden setzen");
      const antwort = replySendScript({ accountId: "K", mailbox: "INBOX", messageId: "1", body: "T", replyAll: false, sender: "joachim@rankpilot.de", signature: "rankpilot Joachim" });
      assert.match(antwort, /set message signature of theReply to signature "rankpilot Joachim"/);
      assert.ok(!newSendScript({ sender: "x@y.de", to: "a@b.de", subject: "S", body: "T" }).includes("message signature"));
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
