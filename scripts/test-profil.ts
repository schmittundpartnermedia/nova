/**
 * Regressionstest Betriebsprofil – ohne Netz (nachgebautes Modell), Wegwerf-DB.
 * Geprüft: Einlesen mit Rohtexten, Nachtragen einer neu gefundenen Adresse (verworfener Betrieb kommt zurück),
 * persönliche Anrede nur mit Namen aus Impressum/Kontakt, erfundener Name wird verworfen, Profil wird nur einmal
 * abgefragt, neue Rohtexte führen zu neuem Verstehen.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

process.env.TZ = "Europe/Berlin";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-profil-"));
process.env.NOVA_HOME = path.join(tmp, "home");
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;

const KOPF = "placeId,name,inhaberName,ansprechpartner,telefon,email,emailQuelle,adresse,ort,entfernungKm,website,finalUrl,kategorien,rating,reviewCount,score,befunde,aufhaenger";

async function main() {
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { env: process.env, encoding: "utf8" });
  if (push.status !== 0) throw new Error(push.stderr);
  const { prisma } = await import("@/lib/prisma");
  const { leseLeadsEin } = await import("@/services/leads");
  const { verstehe, anredeAus, leseProfil } = await import("@/services/leads/profil");
  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });

  const csv1 = path.join(tmp, "gebiet_1.csv");
  fs.writeFileSync(csv1, [KOPF,
    'p1,Kanzleiter Rolf,,,07231 1,,,"Hauptstr. 1, 75172 Pforzheim",Pforzheim,1.0,http://kanzleiter.de/,,,4.5,1,40,nur 1 Bewertungen (< 10),x',
    'p2,schreinerei klenk,,,07231 2,info@schreinereiklenk.de,impressum,"Weg 2, 75172 Pforzheim",Pforzheim,2.0,http://klenk.de/,,,4.9,30,20,,y',
  ].join("\n"));
  const r1 = await leseLeadsEin(org.id, csv1, { branche: "Schreinerei" });
  const tests: Array<[string, () => Promise<void>]> = [
    ["Erster Lauf: ohne Adresse verworfen, mit Adresse im Vorrat, vorläufige Anrede „Hallo zusammen“", async () => {
      assert.deepEqual(r1, { neu: 2, ohneEmail: 1, nachgetragen: 0 });
      const k = await prisma.lead.findFirstOrThrow({ where: { placeId: "p1" } });
      assert.equal(k.status, "verworfen");
      assert.equal(k.anrede, "Hallo zusammen");
    }],
    ["Nachprüfen: Scanner findet jetzt die Adresse und Rohtexte – Betrieb kommt zurück, nichts doppelt", async () => {
      const csv2 = path.join(tmp, "gebiet_1_nachgeprueft.csv");
      fs.writeFileSync(csv2, [KOPF,
        'p1,Kanzleiter Rolf,Rolf Kanzleiter,Rolf Kanzleiter,07231 1,info@kanzleiter.de,impressum,"Hauptstr. 1, 75172 Pforzheim",Pforzheim,1.0,http://kanzleiter.de/,,Schreinerei,4.5,1,40,nur 1 Bewertungen (< 10),x',
        'p2,schreinerei klenk,,,07231 2,info@schreinereiklenk.de,impressum,"Weg 2, 75172 Pforzheim",Pforzheim,2.0,http://klenk.de/,,,4.9,30,20,,y',
      ].join("\n"));
      fs.writeFileSync(csv2.replace(/\.csv$/, ".texte.json"), JSON.stringify({
        p1: { kategorien: ["Schreinerei"], texte: { start: "Titel: Schreinerei Kanzleiter – Innenausbau", impressum: "Schreinerei Kanzleiter\nInhaber: Rolf Kanzleiter\nE-Mail: info@kanzleiter.de" } },
        p2: { kategorien: ["Schreinerei"], texte: { start: "Titel: Schreinerei Klenk", impressum: "Klenk GmbH\nGeschäftsführer: Peter Klenk, Maria Klenk" } },
      }));
      const r2 = await leseLeadsEin(org.id, csv2, { branche: "Schreinerei" });
      assert.deepEqual(r2, { neu: 0, ohneEmail: 0, nachgetragen: 1 });
      assert.equal(await prisma.lead.count(), 2);
      const k = await prisma.lead.findFirstOrThrow({ where: { placeId: "p1" } });
      assert.equal(k.status, "neu");
      assert.equal(k.email, "info@kanzleiter.de");
      assert.match(k.texte ?? "", /Inhaber: Rolf Kanzleiter/);
    }],
    ["Verstehen: sauberer Name, Gewerk, Suchwort; persönliche Anrede aus dem Impressum; nur einmal gefragt", async () => {
      let fragen = 0;
      const auswerter = {
        async strukturiert<T>(input: { eingabe: string }): Promise<T> {
          fragen += 1;
          assert.match(input.eingabe, /--- Impressum ---\nSchreinerei Kanzleiter\nInhaber: Rolf Kanzleiter/);
          return { firmenname: "Schreinerei Kanzleiter", gewerk: "Schreiner", suchwort: "Schreiner", leistungen: ["Innenausbau", "Möbel nach Maß"], ansprechpartner: { anrede: "Herr", vorname: "Rolf", nachname: "Kanzleiter", rolle: "Inhaber" }, hinweis: null } as T;
        },
      };
      const lead = await prisma.lead.findFirstOrThrow({ where: { placeId: "p1" } });
      const p = await verstehe(lead, auswerter);
      assert.equal(p.firmenname, "Schreinerei Kanzleiter");
      assert.equal(p.suchwort, "Schreiner");
      assert.equal(anredeAus(p), "Hallo Herr Kanzleiter");
      const gespeichert = await prisma.lead.findFirstOrThrow({ where: { placeId: "p1" } });
      assert.equal(gespeichert.anrede, "Hallo Herr Kanzleiter");
      await verstehe(gespeichert, auswerter);
      assert.equal(fragen, 1, "zweites Mal aus der Datenbank");
    }],
    ["Erfundener Ansprechpartner (Name steht nicht im Impressum) wird verworfen → „Hallo zusammen“", async () => {
      const lead = await prisma.lead.findFirstOrThrow({ where: { placeId: "p2" } });
      const p = await verstehe(lead, {
        async strukturiert<T>(): Promise<T> {
          return { firmenname: "Schreinerei Klenk", gewerk: "Schreiner", suchwort: "Schreiner", leistungen: [], ansprechpartner: { anrede: "Frau", vorname: "Sabine", nachname: "Müller", rolle: "Marketing" }, hinweis: null } as T;
        },
      });
      assert.equal(p.ansprechpartner, null);
      assert.match(p.hinweis ?? "", /„Müller“ nicht in den Quelltexten gefunden/);
      assert.equal(anredeAus(p), "Hallo zusammen");
      assert.equal(leseProfil(await prisma.lead.findFirstOrThrow({ where: { placeId: "p2" } }))?.firmenname, "Schreinerei Klenk");
    }],
    ["Neue Rohtexte beim nächsten Einlesen: Profil wird verworfen und neu verstanden", async () => {
      const csv3 = path.join(tmp, "gebiet_1_nachgeprueft2.csv");
      fs.writeFileSync(csv3, [KOPF, 'p2,schreinerei klenk,,,07231 2,info@schreinereiklenk.de,impressum,"Weg 2, 75172 Pforzheim",Pforzheim,2.0,http://klenk.de/,,,4.9,30,20,,y'].join("\n"));
      fs.writeFileSync(csv3.replace(/\.csv$/, ".texte.json"), JSON.stringify({ p2: { texte: { impressum: "Klenk GmbH\nGeschäftsführerin: Maria Klenk" } } }));
      await leseLeadsEin(org.id, csv3, { branche: "Schreinerei" });
      const lead = await prisma.lead.findFirstOrThrow({ where: { placeId: "p2" } });
      assert.equal(lead.profil, null);
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
