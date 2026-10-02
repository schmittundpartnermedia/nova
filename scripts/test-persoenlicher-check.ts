/**
 * Regressionstest persönlicher Check im Tagesbetrieb – ohne Netz: Check-Dienst und Modell nachgebaut, Wegwerf-DB.
 * Geprüft: höchstens 2 Checks vorlaufen, erst fertiger Check → Entwurf mit Joachims Vorlage (Anrede aus dem Impressum,
 * Ergebnisse aus dem Bericht, persönlicher Link, kein Firmenname), Firmenname im Ergebnis fliegt raus, fehlgeschlagener
 * Check und Betrieb ohne Website werden aussortiert, Tagesende: vorbereiteter Check wird am nächsten Tag ohne neuen Lauf genutzt.
 */
import assert from "node:assert/strict";
import { wegwerfDatenbank } from "./lib/wegwerf-db";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TZ = "Europe/Berlin";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-pcheck-"));
process.env.NOVA_HOME = path.join(tmp, "home");

const VORLAGE = `Betreff: Unsichtbar ist das neue Pleite

{{anrede}},

mein Name ist Joachim Schmitt. Ich habe mir Ihr Unternehmen angesehen. Dabei ist mir besonders aufgefallen:

{{befunde}}

Ihren persönlichen Check können Sie sich hier in Ruhe ansehen:
{{check_link}}
`;

async function main() {
  wegwerfDatenbank();
  const home = process.env.NOVA_HOME!;
  fs.mkdirSync(path.join(home, "vorlagen"), { recursive: true });
  fs.writeFileSync(path.join(home, "vorlagen", "kunden-check.md"), VORLAGE);

  const { prisma } = await import("@/lib/prisma");
  const { tagesbetriebTick } = await import("@/services/tagesbetrieb");
  const { schreibeEinstellungen } = await import("@/services/tagesbetrieb/einstellungen");
  type Postfach = import("@/services/mail/postfach").Postfach;
  type CheckDienst = import("@/lib/rankpilot/persoenlicher-check").CheckDienst;

  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });
  schreibeEinstellungen({ aktiv: true, organizationId: org.id, vorlage: "kunden-check", absender: "check@b2b-rankpilot.de", maxProTag: 10, wochentage: [1, 2, 3, 4, 5, 6, 7], vorratMindestens: 0, taeglicheFreigabe: false, nachfassTage: 0 });

  const gesendet: Array<{ an: string; betreff: string; text: string }> = [];
  const postfach: Postfach = {
    neueste: async () => [],
    eingang: async () => [],
    lesen: async () => null,
    senden: async (input) => {
      gesendet.push(input);
      return { ok: true, executed: true, messageId: `<${gesendet.length}@t>`, grund: "angenommen" };
    },
    antworten: async () => ({ ok: false, executed: false, grund: "nicht im Test" }),
  };
  const mx = async () => true;

  // Check-Dienst im Speicher
  const starts: Array<{ keyword: string; email: string; name: string; company?: string }> = [];
  const zustand = new Map<string, "running" | "success" | "failed">();
  const checks: CheckDienst = {
    async starte(input) {
      if (input.city === "Nirgendwo") return { ortUnbekannt: input.city };
      starts.push(input);
      const id = `rpc_${String(starts.length).padStart(16, "0")}`;
      zustand.set(id, "running");
      return { checkId: id, wiederverwendet: false };
    },
    async stand(id) {
      return { checkId: id, runStatus: zustand.get(id) ?? "failed" };
    },
    async bericht() {
      return { report: { punch: "Bei „Schreiner Pforzheim“ erscheinen Sie in Google Maps nicht unter den ersten drei.", areas: [] }, visibility: { city: "Pforzheim" } };
    },
  };
  // Modell im Speicher: Profil aus dem Impressum, Ergebnisse je nach Betrieb
  const auswerter = {
    async strukturiert<T>(input: { name: string; eingabe: string }): Promise<T> {
      if (input.name === "betriebsprofil") {
        const kanzleiter = /Kanzleiter/.test(input.eingabe);
        return {
          firmenname: kanzleiter ? "Schreinerei Kanzleiter" : "Holzbau Roth",
          gewerk: "Schreiner",
          suchwort: "Schreiner",
          leistungen: ["Innenausbau"],
          ansprechpartner: kanzleiter ? { anrede: "Herr", vorname: "Rolf", nachname: "Kanzleiter", rolle: "Inhaber" } : null,
          hinweis: null,
        } as T;
      }
      const roth = /Gewerk: Schreiner/.test(input.eingabe) && befundeMitName;
      return {
        befunde: roth
          ? ["Holzbau Roth erscheint bei Google Maps nicht unter den ersten drei Treffern für Schreiner in Pforzheim."]
          : ["Bei der Suche nach einem Schreiner in Pforzheim erscheinen Sie in Google Maps nicht unter den ersten drei Treffern.", "In KI-Suchen wie ChatGPT wird Ihr Betrieb bisher nicht genannt."],
      } as T;
    },
  };
  let befundeMitName = false;
  const tick = (jetzt: Date) => tagesbetriebTick({ organizationId: org.id, jetzt, postfach, mx, werkzeuge: { auswerter, checks } });
  const t = (tag: number, h: number, m: number) => new Date(2026, 9, 5 + tag, h, m);

  const lead = (firma: string, email: string, score: number, extra: Record<string, unknown> = {}) =>
    prisma.lead.create({
      data: {
        organizationId: org.id, firma, anrede: "Hallo zusammen", email, ort: "Pforzheim", website: `https://${email.split("@")[1]}/`,
        quelle: "test", status: "geprueft", score, branche: "Schreinerei",
        texte: JSON.stringify({ texte: { impressum: firma.includes("Kanzleiter") ? "Inhaber: Rolf Kanzleiter" : "Holzbau Roth GmbH" } }),
        ...extra,
      },
    });
  await lead("Kanzleiter Rolf", "info@kanzleiter.de", 90);
  await lead("holzbau roth", "info@holzbau-roth.de", 80);
  await lead("Ohne Website", "info@ohne.de", 70, { website: null });
  await lead("Später", "info@spaeter.de", 10);

  const tests: Array<[string, () => Promise<void>]> = [
    ["Morgens: noch kein Check fertig → genau 2 Checks gestartet (Suchwort aus dem Profil, Kontakt = Mail der Firma), nichts gesendet", async () => {
      const r = await tick(t(0, 7, 55));
      assert.equal(r.aktion, "warte auf persönlichen Check");
      assert.equal(starts.length, 2);
      assert.deepEqual(starts.map((s) => [s.keyword, s.email, s.name, s.company]), [
        ["Schreiner", "info@kanzleiter.de", "Rolf Kanzleiter", "Schreinerei Kanzleiter"],
        ["Schreiner", "info@holzbau-roth.de", "Holzbau Roth", "Holzbau Roth"],
      ]);
      assert.equal(await prisma.lead.count({ where: { status: "check" } }), 2);
      assert.equal(gesendet.length, 0);
      assert.equal((await tick(t(0, 8, 0))).aktion, "warte auf persönlichen Check");
      assert.equal(starts.length, 2, "nicht mehr als 2 gleichzeitig");
    }],
    ["Fertiger Check → Entwurf mit Joachims Vorlage: Anrede aus dem Impressum, Ergebnisse, persönlicher Link, kein Firmenname", async () => {
      zustand.set("rpc_0000000000000001", "success");
      const r = await tick(t(0, 8, 5));
      assert.equal(r.aktion, "gestartet (Dauerfreigabe)");
      assert.equal((await tick(t(0, 8, 10))).aktion, "gesendet");
      assert.equal(gesendet.length, 1);
      const mail = gesendet[0]!;
      assert.equal(mail.an, "info@kanzleiter.de");
      assert.equal(mail.betreff, "Unsichtbar ist das neue Pleite");
      assert.match(mail.text, /^Hallo Herr Kanzleiter,\n/);
      assert.match(mail.text, /aufgefallen:\n\nBei der Suche nach einem Schreiner in Pforzheim erscheinen Sie in Google Maps nicht unter den ersten drei Treffern\.\nIn KI-Suchen wie ChatGPT wird Ihr Betrieb bisher nicht genannt\.\n/, "Ergebnisse direkt untereinander");
      assert.match(mail.text, /hier in Ruhe ansehen:\nhttps:\/\/rankpilot\.de\/check\/r\/rpc_0000000000000001/);
      assert.doesNotMatch(`${mail.betreff}\n${mail.text}`, /Kanzleiter Rolf|Schreinerei Kanzleiter/);
      assert.equal((await prisma.lead.findFirstOrThrow({ where: { email: "info@kanzleiter.de" } })).status, "angeschrieben");
    }],
    ["Ergebnis nennt den Firmennamen → fliegt raus; bleibt nichts, wird der Betrieb nicht angeschrieben", async () => {
      befundeMitName = true;
      zustand.set("rpc_0000000000000002", "success");
      await tick(t(0, 8, 15));
      befundeMitName = false;
      const roth = await prisma.lead.findFirstOrThrow({ where: { email: "info@holzbau-roth.de" } });
      assert.equal(roth.status, "verworfen");
      assert.match(roth.grund ?? "", /Check ohne verwertbare Ergebnisse/);
      assert.equal(gesendet.length, 1);
    }],
    ["Ohne Website: kein Check, mit Grund aussortiert; nächster Betrieb rückt nach", async () => {
      const ohne = await prisma.lead.findFirstOrThrow({ where: { email: "info@ohne.de" } });
      assert.equal(ohne.status, "verworfen");
      assert.match(ohne.grund ?? "", /keine Website/);
      assert.ok(starts.some((s) => s.email === "info@spaeter.de"));
    }],
    ["Ort unbekannt (auch kein Hauptort) → kein Check, aussortiert, Takt läuft weiter", async () => {
      const nirgends = await lead("Nirgends", "info@nirgends.de", 95, { ort: "Nirgendwo" });
      const r = await tick(t(0, 8, 17));
      assert.ok(!r.aktion.startsWith("Fehler"));
      const danach = await prisma.lead.findUniqueOrThrow({ where: { id: nirgends.id } });
      assert.equal(danach.status, "verworfen");
      assert.match(danach.grund ?? "", /Ort für den Check unbekannt: Nirgendwo/);
    }],
    ["Fehlgeschlagener Check → aussortiert mit Grund", async () => {
      const spaeter = await prisma.lead.findFirstOrThrow({ where: { email: "info@spaeter.de" } });
      zustand.set(spaeter.checkId!, "failed");
      await tick(t(0, 8, 20));
      const danach = await prisma.lead.findFirstOrThrow({ where: { email: "info@spaeter.de" } });
      assert.equal(danach.status, "verworfen");
      assert.match(danach.grund ?? "", /persönlicher Check fehlgeschlagen/);
    }],
    ["Tagesende: Beispiel-Mail nicht freigegeben → Check bleibt, nächster Tag ohne neuen Lauf", async () => {
      const morgen = await lead("Morgen GmbH", "info@morgen.de", 60);
      // Tag 2, Joachim will morgens wieder ein Beispiel sehen, gibt es aber nicht frei.
      schreibeEinstellungen({ taeglicheFreigabe: true });
      await tick(t(1, 7, 55));
      const neu = await prisma.lead.findUniqueOrThrow({ where: { id: morgen.id } });
      assert.equal(neu.status, "check");
      zustand.set(neu.checkId!, "success");
      assert.equal((await tick(t(1, 8, 0))).aktion, "freigabe vorgelegt");
      assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: morgen.id } })).status, "bereit");
      await tick(t(1, 17, 5));
      const abends = await prisma.lead.findUniqueOrThrow({ where: { id: morgen.id } });
      assert.equal(abends.status, "check", "Check bleibt erhalten");
      assert.equal(abends.entwurfId, null);
      const vorher = starts.length;
      // Tag 3 mit Dauerfreigabe: derselbe Check wird zum Entwurf und geht raus.
      schreibeEinstellungen({ taeglicheFreigabe: false });
      await tick(t(2, 7, 55));
      await tick(t(2, 8, 0));
      assert.equal(gesendet.at(-1)?.an, "info@morgen.de");
      assert.equal(starts.filter((x) => x.email === "info@morgen.de").length, 1, "kein neuer Check für denselben Betrieb");
      assert.ok(starts.length >= vorher);
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
