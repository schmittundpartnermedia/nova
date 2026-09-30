/**
 * Regressionstest Kundensuche und Kontaktlisten (Phase 4) – ohne Lead-Scanner-API, ohne Apple Mail, ohne App.
 * Wegwerf-Datenbank und -NOVA_HOME; der Scanner ist ein Test-Runner, der eine CSV im Format des Lead-Scanners schreibt.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-kunden-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.NOVA_HOME = path.join(tmp, "home");

const SCANNER_CSV = [
  "﻿name,inhaberName,ansprechpartner,telefon,email,adresse,website,finalUrl,rating,reviewCount,score,befunde,aufhaenger",
  'Schreinerei Zimmermann GmbH & Co.KG,Uwe Zimmermann,Uwe Zimmermann,07231 441292,info@schreinerei-zimmermann.eu,"Bäznerstraße 2, 75172 Pforzheim",http://www.schreinerei-zimmermann.eu/,http://www.schreinerei-zimmermann.eu/,4.9,10,38,keine Meta-Description,Aufhänger A',
  'Holzwerk Nord,,,07231 1111,kontakt@holzwerk-nord.de,"Nordstr. 1, Pforzheim",https://holzwerk-nord.de,https://holzwerk-nord.de/,4.1,5,61,kein SSL/HTTPS,Aufhänger B',
  'Möbelbau Süd,Eva Süd,,07231 2222,,"Südstr. 3, Pforzheim",,,3.9,2,72,keine Website,Aufhänger C',
].join("\n");

async function main() {
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { env: process.env, encoding: "utf8" });
  if (push.status !== 0) throw new Error(`Test-Datenbank konnte nicht angelegt werden:\n${push.stderr}`);

  const { prisma } = await import("@/lib/prisma");
  const { executeTool } = await import("@/services/tools/registry");
  const { fuehreKundensucheAus } = await import("@/services/leads");
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  const { leseKontaktliste } = await import("@/lib/mail/kontaktlisten");
  type ScannerRunner = import("@/lib/leads/scanner").ScannerRunner;

  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });
  const keinPostfach = {
    neueste: async () => { throw new Error("kein Postfach im Test"); },
    lesen: async () => { throw new Error("kein Postfach im Test"); },
    senden: async () => { throw new Error("kein Postfach im Test"); },
    antworten: async () => { throw new Error("kein Postfach im Test"); },
  };
  const ctx = { organizationId: org.id, postfach: keinPostfach };
  const run = (name: string, args: Record<string, unknown>) => executeTool(name, args, ctx);
  const scannerAufrufe: unknown[] = [];
  const testScanner: ScannerRunner = async (auftrag) => {
    scannerAufrufe.push(auftrag);
    const pfad = path.join(tmp, `scan-${scannerAufrufe.length}.csv`);
    fs.writeFileSync(pfad, SCANNER_CSV);
    return { csvPfad: pfad, ausgabe: `CSV geschrieben: ${pfad}` };
  };
  const heute = new Date("2026-09-30T10:00:00Z");

  const { feststellungAus } = await import("@/lib/leads/feststellung");
  const { fillMailTemplate } = await import("@/lib/mail/templates");

  const tests: Array<[string, () => Promise<void>]> = [
    [
      "Feststellung aus Scanner-Befunden: wichtigste zwei, lesbar, nichts erfunden; ohne Befund fällt die Zeile weg",
      async () => {
        assert.equal(
          feststellungAus("keine Meta-Description; nur 4 Bewertungen (< 10); kein SSL/HTTPS"),
          "Ihr Google-Profil bisher nur 4 Bewertungen hat und Ihre Website ohne sichere HTTPS-Verbindung läuft",
        );
        assert.equal(feststellungAus("nur eine GMB-Kategorie gepflegt"), "in Ihrem Google-Unternehmensprofil nur eine Kategorie gepflegt ist");
        assert.equal(feststellungAus("Bewertungsschnitt 3.7 (< 4,0)"), "Ihr Bewertungsschnitt bei Google aktuell bei 3,7 Sternen liegt");
        assert.equal(feststellungAus("langsame Ladezeit (TTFB 2.4s > 1,5s)"), "Ihre Website erst nach 2,4 Sekunden antwortet");
        assert.equal(feststellungAus("Domain-Wechsel: a.de -> b.de; Redirect nicht auflösbar"), "");
        assert.equal(feststellungAus(""), "");
        // Optionale Zeile: mit Befund drin, ohne Befund fällt sie ganz weg (kein Loch, keine erfundene Feststellung).
        const vorlage = "A\n\nDabei ist mir aufgefallen, dass {{?feststellung}}. Das zählt.\n\nB {{firma}}";
        const mit = fillMailTemplate(vorlage, { firma: "X", feststellung: feststellungAus("kein SSL/HTTPS") });
        assert.equal(mit.text, "A\n\nDabei ist mir aufgefallen, dass Ihre Website ohne sichere HTTPS-Verbindung läuft. Das zählt.\n\nB X");
        const ohne = fillMailTemplate(vorlage, { firma: "X", feststellung: feststellungAus("") });
        assert.equal(ohne.text, "A\n\nB X");
        assert.deepEqual(ohne.fehlend, []);
        // Pflicht-Platzhalter bleiben Pflicht.
        assert.deepEqual(fillMailTemplate(vorlage, {}).fehlend, ["firma"]);
      },
    ],
    ["Kundensuche ohne Freigabe: Rückfrage mit Kosten, kein Lauf", async () => {
      const result = await run("kunden_suchen", { branche: "Schreinerei", ort: "Pforzheim", anzahl: 20, freigabe_id: "" });
      const data = result.data as { status: string; kosten_usd: number };
      assert.equal(data.status, "freigabe_noetig");
      assert.equal(data.kosten_usd, 0.035);
      assert.equal(result.executed, false);
      assert.equal(await prisma.workItem.count({ where: { kind: "scanner.lauf" } }), 0);
    }],
    ["Freigabe gilt nur für genau diese Suche; danach Lauf im Hintergrund geplant", async () => {
      const frage = await run("kunden_suchen", { branche: "Schreinerei", ort: "Pforzheim", anzahl: 40, freigabe_id: "" });
      const freigabeId = (frage.data as { freigabe_id: string }).freigabe_id;
      assert.equal((frage.data as { kosten_usd: number }).kosten_usd, 0.07);
      const falsch = await run("kunden_suchen", { branche: "Schreinerei", ort: "Karlsruhe", anzahl: 40, freigabe_id: freigabeId });
      assert.equal(falsch.ok, false);
      const richtig = await run("kunden_suchen", { branche: "Schreinerei", ort: "Pforzheim", anzahl: 40, freigabe_id: freigabeId });
      assert.equal((richtig.data as { status: string }).status, "gestartet");
      assert.equal(richtig.executed, true);
      const item = await prisma.workItem.findFirstOrThrow({ where: { kind: "scanner.lauf" } });
      assert.deepEqual(JSON.parse(item.payload), { branche: "Schreinerei", ort: "Pforzheim", anzahl: 40 });
      assert.equal(scannerAufrufe.length, 0, "Werkzeug startet den Scanner nicht selbst, das macht der Worker");
    }],
    ["Worker-Lauf: Ergebnis wird Kundenliste mit Anrede, Firmen und Kontakte, Meldung mit Zahlen", async () => {
      const result = await fuehreKundensucheAus({ organizationId: org.id, auftrag: { branche: "Schreinerei", ort: "Pforzheim", anzahl: 20 }, runner: testScanner, heute });
      assert.equal(result.ok, true);
      assert.equal(scannerAufrufe.length, 1);
      const liste = leseKontaktliste("kunden-schreinerei-pforzheim-2026-09-30").map((zeile) => zeile.werte);
      assert.deepEqual(
        liste.map((k) => [k.firma, k.anrede, k.email]),
        [
          ["Schreinerei Zimmermann GmbH & Co.KG", "Guten Tag Uwe Zimmermann", "info@schreinerei-zimmermann.eu"],
          ["Holzwerk Nord", "Sehr geehrtes Holzwerk Nord-Team", "kontakt@holzwerk-nord.de"],
          ["Möbelbau Süd", "Guten Tag Eva Süd", ""],
        ],
      );
      assert.equal(liste[0]!.befunde, "keine Meta-Description");
      assert.equal(liste[0]!.feststellung, "Ihre Startseite keine Beschreibung für die Google-Ergebnisse hat");
      assert.equal(liste[1]!.feststellung, "Ihre Website ohne sichere HTTPS-Verbindung läuft");
      assert.equal(liste[2]!.feststellung, "", "unbekannter Befund ergibt keine erfundene Feststellung");
      assert.equal(await prisma.company.count({ where: { organizationId: org.id } }), 3);
      assert.equal(await prisma.contact.count({ where: { organizationId: org.id } }), 3);
      const uwe = await prisma.contact.findFirstOrThrow({ where: { email: "info@schreinerei-zimmermann.eu" } });
      assert.equal(uwe.firstName, "Uwe");
      assert.equal(uwe.lastName, "Zimmermann");
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.length, 1);
      assert.match(meldungen[0]!.text, /3 Betriebe, 2 mit E-Mail, 2 mit Ansprechpartner/);
      assert.match(meldungen[0]!.text, /Größter Handlungsbedarf: Möbelbau Süd, Holzwerk Nord, Schreinerei Zimmermann/);
    }],
    ["Zweiter Lauf mit denselben Betrieben legt keine Firmen oder Kontakte doppelt an", async () => {
      await fuehreKundensucheAus({ organizationId: org.id, auftrag: { branche: "Schreinerei", ort: "Pforzheim", anzahl: 20 }, runner: testScanner, heute });
      assert.equal(await prisma.company.count({ where: { organizationId: org.id } }), 3);
      assert.equal(await prisma.contact.count({ where: { organizationId: org.id } }), 3);
      await holeNeueMeldungen(org.id);
    }],
    ["Scanner-Fehler wird ehrlich gemeldet", async () => {
      const kaputt: ScannerRunner = async () => { throw new Error("Places-Key ungültig"); };
      const result = await fuehreKundensucheAus({ organizationId: org.id, auftrag: { branche: "Maler", ort: "Calw", anzahl: 5 }, runner: kaputt });
      assert.equal(result.ok, false);
      const meldungen = await holeNeueMeldungen(org.id);
      assert.match(meldungen[0]!.text, /fehlgeschlagen: Places-Key ungültig/);
    }],
    ["Dauerfreigabe Scanner mit Tageslimit: erster Lauf ohne Rückfrage, dann wieder Rückfrage", async () => {
      await prisma.workItem.deleteMany({ where: { kind: "scanner.lauf" } });
      await run("freigabe_scanner_dauer", { aktion: "erteilen", max_pro_tag: 1 });
      const erster = await run("kunden_suchen", { branche: "Elektriker", ort: "Calw", anzahl: 10, freigabe_id: "" });
      assert.equal((erster.data as { status: string }).status, "gestartet");
      const zweiter = await run("kunden_suchen", { branche: "Elektriker", ort: "Nagold", anzahl: 10, freigabe_id: "" });
      assert.equal((zweiter.data as { status: string }).status, "freigabe_noetig");
      assert.match((zweiter.data as { grund: string }).grund, /Tageslimit/);
      await run("freigabe_scanner_dauer", { aktion: "widerrufen", max_pro_tag: 0 });
    }],
    ["Sponsor-Kontakte eintragen: Liste wird angelegt, doppelte und ungültige Adressen abgewiesen", async () => {
      const a = await run("kontakt_hinzufuegen", { liste: "sponsoren", firma: "Zurich", ansprechpartner: "Thomas Wolf", anrede: "Sehr geehrter Herr Wolf", email: "thomas.wolf@zurich.com", bereich: "Unternehmens- und Gewerbeversicherungen" });
      assert.equal(a.executed, true);
      const b = await run("kontakt_hinzufuegen", { liste: "sponsoren", firma: "Mollie", ansprechpartner: "", anrede: "Sehr geehrtes Mollie-Team", email: "partners@mollie.com", bereich: "Zahlungsabwicklung" });
      assert.equal((b.data as { anzahl: number }).anzahl, 2);
      const doppelt = await run("kontakt_hinzufuegen", { liste: "sponsoren", firma: "Zurich", ansprechpartner: "Thomas Wolf", anrede: "Sehr geehrter Herr Wolf", email: "Thomas.Wolf@zurich.com", bereich: "x" });
      assert.equal(doppelt.executed, false);
      const kaputt = await run("kontakt_hinzufuegen", { liste: "sponsoren", firma: "X", ansprechpartner: "", anrede: "Hallo", email: "keine-adresse", bereich: "" });
      assert.equal(kaputt.ok, false);
      const anzeige = await run("kontaktliste_anzeigen", { liste: "sponsoren" });
      assert.equal((anzeige.data as { anzahl: number }).anzahl, 2);
    }],
    ["Eingetragene Sponsoren lassen sich mit der Vorlage als Kampagne planen (Anrede, Firma, Bereich gefüllt)", async () => {
      const vorlagen = path.join(process.env.NOVA_HOME!, "vorlagen");
      fs.mkdirSync(vorlagen, { recursive: true });
      fs.writeFileSync(path.join(vorlagen, "sponsoren.md"), "Betreff: Partnerschaft mit {{firma}}\n\n{{anrede}},\n\nfür den Bereich „{{bereich}}“ möchten wir {{firma}} gewinnen.\n");
      const plan = await run("kampagne_planen", { vorlage: "sponsoren", liste: "sponsoren", abstand_minuten: 5, absender: "joachim@rankpilot.de" });
      assert.equal(plan.ok, true, plan.error);
      const data = plan.data as { anzahl: number; beispiel: { betreff: string; text: string } };
      assert.equal(data.anzahl, 2);
      assert.equal(data.beispiel.betreff, "Partnerschaft mit Zurich");
      assert.equal(data.beispiel.text, "Sehr geehrter Herr Wolf,\n\nfür den Bereich „Unternehmens- und Gewerbeversicherungen“ möchten wir Zurich gewinnen.");
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
