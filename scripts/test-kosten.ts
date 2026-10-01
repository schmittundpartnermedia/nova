/**
 * Regressionstest Kostenübersicht – ohne Netz: Kostenbuch, Preistabelle, Claude-Aufträge, Google-Anfragen.
 * Geprüft: bekannte Preise werden umgerechnet, unbekannte ehrlich als „fehlt“ gemeldet, eigene Preise überschreiben.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wegwerfDatenbank } from "./lib/wegwerf-db";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-kosten-"));
process.env.NOVA_HOME = path.join(tmp, "home");

async function main() {
  wegwerfDatenbank();
  const { prisma } = await import("@/lib/prisma");
  const { bucheVerbrauch, leseBuchungen, usdFuer, lesePreise, preisDatei } = await import("@/lib/kosten");
  const { kostenUebersicht, zeitraum } = await import("@/services/kosten");
  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });
  const jetzt = new Date();
  const tests: Array<[string, () => Promise<void>]> = [
    ["Kostenbuch: Buchungen landen im Monatsbuch und werden nach Zeitraum gelesen", async () => {
      bucheVerbrauch({ art: "kopf", modell: "gpt-6-astra", eingabeTokens: 12_000, ausgabeTokens: 800 });
      bucheVerbrauch({ art: "spracherkennung", modell: "gpt-4o-mini-transcribe", sekunden: 120 });
      bucheVerbrauch({ art: "websuche", modell: "gpt-4o-mini", eingabeTokens: 1_000_000, ausgabeTokens: 0 });
      bucheVerbrauch({ art: "websuche", modell: "web_search", anfragen: 3 });
      bucheVerbrauch({ art: "kopf", modell: "gpt-6-astra", eingabeTokens: 5, zeit: new Date(jetzt.getTime() - 40 * 86_400_000) });
      const { von, bis } = zeitraum("heute", jetzt);
      assert.equal(leseBuchungen(von, new Date(bis.getTime() + 1000)).length, 4, "alte Buchung liegt außerhalb");
    }],
    ["Preise: bekannte werden umgerechnet, unbekannte ergeben null statt einer erfundenen Zahl", async () => {
      const preise = lesePreise();
      assert.equal(usdFuer({ zeit: "", art: "spracherkennung", modell: "gpt-4o-mini-transcribe", sekunden: 120 }, preise), 0.006);
      assert.equal(usdFuer({ zeit: "", art: "kopf", modell: "gpt-6-astra", eingabeTokens: 1000 }, preise), null);
      assert.equal(usdFuer({ zeit: "", art: "websuche", modell: "web_search", anfragen: 3 }, preise), null);
    }],
    ["Übersicht: OpenAI, Claude Code und Google zusammen; fehlende Preise ehrlich ausgewiesen", async () => {
      const auftraege = path.join(process.env.NOVA_HOME!, "claude", "auftraege");
      fs.mkdirSync(auftraege, { recursive: true });
      fs.writeFileSync(path.join(auftraege, "a.json"), JSON.stringify({ id: "a", organizationId: org.id, projekt: "x", aufgabe: "y", abnahmekriterium: "z", branch: "b", status: "live", erstellt: jetzt.toISOString(), kostenUsd: 0.42 }));
      fs.writeFileSync(path.join(auftraege, "b.json"), JSON.stringify({ id: "b", organizationId: org.id, projekt: "x", aufgabe: "y", abnahmekriterium: "z", branch: "b", status: "laeuft", erstellt: jetzt.toISOString() }));
      await prisma.workItem.create({ data: { organizationId: org.id, kind: "scanner.lauf", idempotencyKey: "s1", payload: "{}", status: "completed", runAt: jetzt, audit: "[{\"note\":\"656 Betriebe, 341 neu im Vorrat, 103 Anfragen → liste\"}]" } });
      const { von, bis } = zeitraum("heute", jetzt);
      const k = await kostenUebersicht({ organizationId: org.id, von, bis: new Date(bis.getTime() + 1000) });
      const nach = Object.fromEntries(k.posten.map((p) => [p.posten, p]));
      assert.equal(nach["Claude Code (Programmier-Aufträge)"]!.usd, 0.42);
      assert.match(nach["Claude Code (Programmier-Aufträge)"]!.hinweis ?? "", /1 Auftrag\/Aufträge ohne Kostenangabe/);
      assert.equal(Math.round(nach["Google Places (Kundensuche)"]!.usd! * 100) / 100, 3.61);
      assert.equal(nach["NOVAs Kopf (OpenAI) – gpt-6-astra"]!.usd, null);
      assert.match(nach["NOVAs Kopf (OpenAI) – gpt-6-astra"]!.hinweis ?? "", /Preis für gpt-6-astra fehlt/);
      assert.equal(nach["Websuche (OpenAI) – gpt-4o-mini"]!.usd, 0.15);
      assert.equal(k.vollstaendig, false);
      assert.deepEqual(k.ohne_preis.sort(), ["NOVAs Kopf (OpenAI) – gpt-6-astra", "Websuche (OpenAI) – web_search"]);
      assert.equal(k.summe_usd, Math.round((0.42 + 3.605 + 0.006 + 0.15) * 100) / 100);
    }],
    ["Gecachte Tokens werden zum Cache-Preis gerechnet", async () => {
      const preise = { m: { proMioEingabeTokens: 10, proMioGecachteTokens: 1, proMioAusgabeTokens: 50 } };
      assert.equal(usdFuer({ zeit: "", art: "kopf", modell: "m", eingabeTokens: 1_000_000, gecachteTokens: 800_000, ausgabeTokens: 0 }, preise), 2.8);
    }],
    ["Eigene Preise in ~/Nova/preise.json schließen die Lücke", async () => {
      fs.writeFileSync(preisDatei(), JSON.stringify({ "gpt-6-astra": { proMioEingabeTokens: 2, proMioAusgabeTokens: 8 }, web_search: { proAnfrage: 0.01 } }));
      const { von, bis } = zeitraum("heute", jetzt);
      const k = await kostenUebersicht({ organizationId: org.id, von, bis: new Date(bis.getTime() + 1000) });
      assert.equal(k.vollstaendig, true);
      const kopf = k.posten.find((p) => p.posten.includes("gpt-6-astra"))!;
      assert.equal(Math.round(kopf.usd! * 10000) / 10000, Math.round((0.024 + 0.0064) * 10000) / 10000);
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
