/**
 * Regressionstest Postfach über IMAP/SMTP – ohne Netz: nachgebautes Postfach (IMAP und SMTP im Speicher).
 * Geprüft: neueste über alle Konten, nichts wird beim Lesen als gelesen markiert, Eingang aus Posteingang und Spam
 * mit Verlauf und Abwesenheits-Erkennung, Lesen einer verschobenen Mail über die Message-ID, Senden nur von
 * erlaubten Absendern und nur mit Passwort, Ablage in „Gesendet“, abgelehnte Empfänger, gescheiterte Ablage
 * (gesendet bleibt gesendet), Antworten mit Verlauf und Zitat, ein kaputtes Konto hält die anderen nicht auf.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-imap-"));
process.env.NOVA_HOME = path.join(tmp, "home");

type Nachricht = { uid: number; raw: Buffer; flags: Set<string>; internalDate: Date };
type Ordner = { path: string; specialUse?: string; nachrichten: Nachricht[]; naechste: number };

class FakeServer {
  ordner = new Map<string, Ordner>();
  smtp: Array<{ from: string; to: string[]; raw: Buffer }> = [];
  smtpAblehnen = false;
  appendKaputt = false;
  verbindungen = 0;
  constructor(public konto: string) {
    for (const [p, use] of [["INBOX", undefined], ["Spam", "\\Junk"], ["Gesendete Objekte", "\\Sent"]] as const) {
      this.ordner.set(p, { path: p, specialUse: use, nachrichten: [], naechste: 1 });
    }
  }
  lege(pfad: string, raw: string, internalDate: Date, flags: string[] = []) {
    const o = this.ordner.get(pfad)!;
    o.nachrichten.push({ uid: o.naechste++, raw: Buffer.from(raw.replace(/\n/g, "\r\n")), flags: new Set(flags), internalDate });
  }
}

function mail(k: { von: string; an: string; betreff: string; id: string; datum: Date; text: string; kopf?: string }): string {
  return [
    `From: ${k.von}`,
    `To: ${k.an}`,
    `Subject: ${k.betreff}`,
    `Message-ID: <${k.id}>`,
    `Date: ${k.datum.toUTCString()}`,
    ...(k.kopf ? [k.kopf] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    k.text,
  ].join("\n");
}

function verbindungZu(server: FakeServer) {
  server.verbindungen += 1;
  let aktuell: Ordner | null = null;
  const passt = (n: Nachricht, q: Record<string, unknown>): boolean => {
    if (q.seen === false && n.flags.has("\\Seen")) return false;
    if (q.since instanceof Date) {
      const tag = new Date(q.since.getFullYear(), q.since.getMonth(), q.since.getDate());
      if (n.internalDate < tag) return false;
    }
    if (typeof q.uid === "string" && !q.uid.split(",").map(Number).includes(n.uid)) return false;
    const header = q.header as Record<string, string> | undefined;
    if (header?.["message-id"]) {
      const id = header["message-id"].replace(/^<|>$/g, "");
      if (!n.raw.toString("utf8").includes(`<${id}>`)) return false;
    }
    return true;
  };
  return {
    async list() {
      return [...server.ordner.values()].map((o) => ({ path: o.path, specialUse: o.specialUse }));
    },
    async getMailboxLock(p: string) {
      const o = server.ordner.get(p);
      if (!o) throw new Error(`Ordner ${p} fehlt`);
      aktuell = o;
      return { release() {} };
    },
    async search(q: Record<string, unknown>) {
      return aktuell!.nachrichten.filter((n) => passt(n, q)).map((n) => n.uid);
    },
    async fetchAll(uids: number[], query: { source: true | { maxLength: number } }) {
      return aktuell!.nachrichten
        .filter((n) => uids.includes(n.uid))
        .map((n) => ({ uid: n.uid, flags: new Set(n.flags), internalDate: n.internalDate, source: query.source === true ? n.raw : n.raw.subarray(0, query.source.maxLength) }));
    },
    async append(p: string, content: Buffer, flags: string[] = []) {
      if (server.appendKaputt) throw new Error("Ablage verweigert");
      server.lege(p, content.toString("utf8").replace(/\r\n/g, "\n"), new Date(), flags);
      return {};
    },
    async messageFlagsAdd(uids: number[], flags: string[]) {
      for (const n of aktuell!.nachrichten) if (uids.includes(n.uid)) flags.forEach((f) => n.flags.add(f));
      return true;
    },
    async logout() {},
  };
}

async function main() {
  const home = process.env.NOVA_HOME!;
  fs.mkdirSync(path.join(home, "geheim", "mail"), { recursive: true });
  fs.mkdirSync(path.join(home, "signaturen"), { recursive: true });
  fs.writeFileSync(path.join(home, "mailkonten.txt"), "# Konten\njoachim@rankpilot.de\ncheck@b2b-rankpilot.de\n");
  fs.writeFileSync(path.join(home, "geheim", "mail", "joachim@rankpilot.de"), "pw-j\n");
  fs.writeFileSync(path.join(home, "absendernamen.txt"), "check@b2b-rankpilot.de = rankPilot Joachim Schmitt\n");
  fs.writeFileSync(path.join(home, "signaturen", "check@b2b-rankpilot.de.txt"), "Viele Grüße\n**Joachim Schmitt**");

  const { ImapPostfach } = await import("@/connectors/mail/imap");
  const { simpleParser } = await import("mailparser");
  const server = new Map([["joachim@rankpilot.de", new FakeServer("joachim@rankpilot.de")], ["check@b2b-rankpilot.de", new FakeServer("check@b2b-rankpilot.de")]]);
  const kaputt = new Set<string>();
  const postfach = new ImapPostfach({
    async verbinde({ konto, passwort }) {
      if (kaputt.has(konto.email)) throw new Error("Anmeldung fehlgeschlagen");
      assert.ok(passwort, "Passwort wird übergeben");
      return verbindungZu(server.get(konto.email)!) as never;
    },
    smtp({ konto }) {
      const s = server.get(konto.email)!;
      return {
        async sendMail({ envelope, raw }) {
          if (s.smtpAblehnen) return { accepted: [], rejected: envelope.to, response: "550 Postfach unbekannt" };
          s.smtp.push({ from: envelope.from, to: envelope.to, raw });
          return { accepted: envelope.to, rejected: [] };
        },
      };
    },
  });

  const j = server.get("joachim@rankpilot.de")!;
  const c = server.get("check@b2b-rankpilot.de")!;
  const heute9 = new Date(2026, 9, 2, 9, 0);
  j.lege("INBOX", mail({ von: "Anna <anna@x.de>", an: "joachim@rankpilot.de", betreff: "Alt", id: "alt@x.de", datum: new Date(2026, 8, 30), text: "alt" }), new Date(2026, 8, 30), ["\\Seen"]);
  j.lege("INBOX", mail({ von: "Ben <ben@y.de>", an: "joachim@rankpilot.de", betreff: "Frage", id: "frage@y.de", datum: heute9, text: "Haben Sie Zeit?\nGruß Ben" }), heute9);
  // Ankunftsreihenfolge wie auf einem echten Server: höhere UID = später eingegangen.
  c.lege("INBOX", mail({ von: "Früh <f@x.de>", an: "check@b2b-rankpilot.de", betreff: "Früh", id: "frueh@x.de", datum: new Date(2026, 9, 2, 7, 0), text: "früh" }), new Date(2026, 9, 2, 7, 0));
  c.lege("INBOX", mail({ von: "Weber <info@weber.example>", an: "check@b2b-rankpilot.de", betreff: "Re: Sichtbarkeit", id: "w1@weber.example", datum: new Date(2026, 9, 2, 10, 0), text: "Rufen Sie mich an.", kopf: "In-Reply-To: <k1@b2b-rankpilot.de>\nReferences: <k0@b2b-rankpilot.de> <k1@b2b-rankpilot.de>" }), new Date(2026, 9, 2, 10, 0));
  c.lege("Spam", mail({ von: "Maier <m@maier.example>", an: "check@b2b-rankpilot.de", betreff: "Abwesend", id: "ab@maier.example", datum: new Date(2026, 9, 2, 10, 5), text: "Bin im Urlaub.", kopf: "Auto-Submitted: auto-replied\nIn-Reply-To: <k2@b2b-rankpilot.de>" }), new Date(2026, 9, 2, 10, 5));

  const tests: Array<[string, () => Promise<void>]> = [
    ["Ohne Passwort: Konto wird ehrlich als nicht lesbar gemeldet, die anderen werden gelesen", async () => {
      const liste = await postfach.neueste({ anzahl: 10, nurUngelesen: false });
      assert.deepEqual(liste.map((m) => m.betreff), ["Frage", "Alt"], "nur joachim@ (check@ hat noch kein Passwort)");
      fs.writeFileSync(path.join(home, "geheim", "mail", "check@b2b-rankpilot.de"), "pw-c");
    }],
    ["Neueste: über alle Konten, neueste zuerst; ungelesen filtert; Lesen markiert nichts als gelesen", async () => {
      const alle = await postfach.neueste({ anzahl: 3, nurUngelesen: false });
      assert.deepEqual(alle.map((m) => m.betreff), ["Re: Sichtbarkeit", "Frage", "Früh"]);
      assert.equal(alle[0]!.konto, "check@b2b-rankpilot.de");
      assert.match(alle[1]!.textanfang, /^Haben Sie Zeit\?/);
      const ungelesen = await postfach.neueste({ anzahl: 10, nurUngelesen: true });
      assert.ok(!ungelesen.some((m) => m.betreff === "Alt"));
      const voll = await postfach.lesen(alle[1]!.ref);
      assert.equal(voll?.text, "Haben Sie Zeit?\nGruß Ben");
      assert.deepEqual(voll?.an, ["joachim@rankpilot.de"]);
      assert.equal(j.ordner.get("INBOX")!.nachrichten[1]!.flags.has("\\Seen"), false, "nicht als gelesen markiert");
    }],
    ["Eingang: Posteingang und Spam seit Zeitpunkt, mit Verlauf und Abwesenheits-Erkennung", async () => {
      const e = await postfach.eingang({ seit: new Date(2026, 9, 2, 8, 0), max: 50 });
      assert.deepEqual(e.map((m) => m.betreff), ["Frage", "Re: Sichtbarkeit", "Abwesend"], "„Früh“ (7 Uhr) liegt vor dem Zeitpunkt");
      const weber = e.find((m) => m.betreff === "Re: Sichtbarkeit")!;
      assert.deepEqual([...weber.bezuege].sort(), ["k0@b2b-rankpilot.de", "k1@b2b-rankpilot.de"]);
      assert.equal(weber.messageId, "w1@weber.example");
      assert.equal(weber.automatisch, false);
      assert.equal(e.find((m) => m.betreff === "Abwesend")!.automatisch, true);
    }],
    ["Lesen: verschobene/neu nummerierte Mail wird über die Message-ID gefunden", async () => {
      const ref = (await postfach.neueste({ anzahl: 1, nurUngelesen: false }))[0]!.ref;
      const inbox = c.ordner.get("INBOX")!;
      inbox.nachrichten.find((n) => n.raw.toString().includes("w1@weber.example"))!.uid = 99;
      const voll = await postfach.lesen(ref);
      assert.equal(voll?.text, "Rufen Sie mich an.");
    }],
    ["Senden: nur erlaubte Absender; Name, HTML-Fettdruck und Signatur; im Ordner Gesendet abgelegt und gefunden", async () => {
      const fremd = await postfach.senden({ absender: "x@gmail.com", an: "a@b.de", betreff: "S", text: "T" });
      assert.equal(fremd.executed, false);
      const r = await postfach.senden({ absender: "check@b2b-rankpilot.de", an: "Weber <info@weber.example>", betreff: "Ihr **Check**", text: "Hallo **Herr Weber**,\n\nanbei." });
      assert.equal(r.ok, true);
      assert.equal(r.executed, true);
      assert.match(r.ok ? r.grund : "", /im Ordner Gesendet abgelegt/);
      assert.equal(c.smtp.length, 1);
      assert.deepEqual(c.smtp[0]!.to, ["info@weber.example"]);
      assert.equal(c.smtp[0]!.from, "check@b2b-rankpilot.de");
      const m = await simpleParser(c.smtp[0]!.raw);
      assert.equal(m.subject, "Ihr Check");
      assert.equal(m.from?.value[0]?.name, "rankPilot Joachim Schmitt");
      assert.match(String(m.html), /Hallo <strong>Herr Weber<\/strong>/);
      assert.match(String(m.html), /<strong>Joachim Schmitt<\/strong>/);
      assert.match(m.text ?? "", /anbei\.\n\nViele Grüße\nJoachim Schmitt$/);
      const gesendet = c.ordner.get("Gesendete Objekte")!.nachrichten;
      assert.equal(gesendet.length, 1);
      assert.ok(gesendet[0]!.flags.has("\\Seen"));
      assert.ok(r.ok && gesendet[0]!.raw.toString().includes(r.messageId));
    }],
    ["Abgelehnter Empfänger: nicht gesendet, nichts in Gesendet", async () => {
      c.smtpAblehnen = true;
      const r = await postfach.senden({ absender: "check@b2b-rankpilot.de", an: "weg@nirgends.example", betreff: "S", text: "T" });
      c.smtpAblehnen = false;
      assert.equal(r.executed, false);
      assert.match(r.ok ? "" : r.grund, /abgelehnt.*550/);
      assert.equal(c.ordner.get("Gesendete Objekte")!.nachrichten.length, 1);
    }],
    ["Ablage in Gesendet scheitert: Mail bleibt gesendet (kein zweiter Versand), Grund wird genannt", async () => {
      c.appendKaputt = true;
      const r = await postfach.senden({ absender: "check@b2b-rankpilot.de", an: "info@weber.example", betreff: "S2", text: "T" });
      c.appendKaputt = false;
      assert.equal(r.executed, true);
      assert.match(r.ok ? r.grund : "", /angenommen \(gesendet\).*Ablage.*fehlgeschlagen/);
      assert.equal(c.smtp.length, 2);
    }],
    ["Antworten: von check@ auf eine Mail in joachim@; Verlauf, Zitat, Original als beantwortet markiert", async () => {
      const ben = (await postfach.neueste({ anzahl: 5, nurUngelesen: false })).find((m) => m.betreff === "Frage")!;
      const r = await postfach.antworten({ absender: "check@b2b-rankpilot.de", ref: ben.ref, an: "ben@y.de", betreff: "Re: Frage", text: "Ja, gern." });
      assert.equal(r.executed, true);
      const m = await simpleParser(c.smtp.at(-1)!.raw);
      assert.equal(m.inReplyTo, "<frage@y.de>");
      assert.deepEqual(m.references, "<frage@y.de>");
      assert.match(m.text ?? "", /Ja, gern\.[\s\S]*schrieb Ben <ben@y\.de>:\n> Haben Sie Zeit\?/);
      assert.ok(j.ordner.get("INBOX")!.nachrichten[1]!.flags.has("\\Answered"));
      assert.equal(j.ordner.get("INBOX")!.nachrichten[1]!.flags.has("\\Seen"), false);
    }],
    ["Ein Konto mit falschem Passwort hält die anderen nicht auf; scheitern alle, gibt es einen Fehler", async () => {
      kaputt.add("joachim@rankpilot.de");
      const liste = await postfach.neueste({ anzahl: 10, nurUngelesen: false });
      assert.ok(liste.every((m) => m.konto === "check@b2b-rankpilot.de") && liste.length > 0);
      kaputt.add("check@b2b-rankpilot.de");
      await assert.rejects(postfach.neueste({ anzahl: 10, nurUngelesen: false }), /Kein Postfach lesbar/);
      kaputt.clear();
      const ohnePw = await postfach.senden({ absender: "info@elevum.io", an: "a@b.de", betreff: "S", text: "T" });
      assert.match(ohnePw.ok ? "" : ohnePw.grund, /nicht eingetragen/);
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
