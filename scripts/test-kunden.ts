/**
 * Regressionstest Kundensuche (Gebietssuche) und Kontaktlisten (Phase 4) – ohne Lead-Scanner-API, ohne Apple Mail, ohne App.
 * Wegwerf-Datenbank und -NOVA_HOME; der Scanner ist ein Test-Runner, der eine CSV im Format des Lead-Scanners schreibt.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wegwerfDatenbank } from "./lib/wegwerf-db";

// Deutsche Zeit wie auf dem Server (pm2: TZ=Europe/Berlin), unabhängig vom Rechner, auf dem der Test läuft.
process.env.TZ = "Europe/Berlin";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-kunden-"));
process.env.NOVA_HOME = path.join(tmp, "home");

// Ausgabe der Gebietssuche (lead-scanner/src/gebiet.ts)
const SCANNER_CSV = [
  "﻿placeId,name,inhaberName,ansprechpartner,telefon,email,adresse,ort,entfernungKm,website,finalUrl,rating,reviewCount,score,befunde,aufhaenger",
  'p1,Schreinerei Zimmermann GmbH & Co.KG,Uwe Zimmermann,Uwe Zimmermann,07231 441292,info@schreinerei-zimmermann.eu,"Bäznerstraße 2, 75172 Pforzheim",Pforzheim,1.2,http://www.schreinerei-zimmermann.eu/,http://www.schreinerei-zimmermann.eu/,4.9,10,38,keine Meta-Description,Aufhänger A',
  'p2,Holzwerk Nord,,,07041 1111,kontakt@holzwerk-nord.de,"Nordstr. 1, 75417 Mühlacker",Mühlacker,12.3,https://holzwerk-nord.de,https://holzwerk-nord.de/,4.1,5,61,kein SSL/HTTPS,Aufhänger B',
  'p3,Möbelbau Süd,Eva Süd,,07051 2222,,"Südstr. 3, 75365 Calw",Calw,20.1,,,3.9,2,72,keine Website,Aufhänger C',
].join("\n");

async function main() {
  wegwerfDatenbank();

  const { prisma } = await import("@/lib/prisma");
  const { executeTool } = await import("@/services/tools/registry");
  const { fuehreGebietssucheAus } = await import("@/services/leads");
  const { schaetzeKosten } = await import("@/lib/leads/scanner");
  const mx = async () => true;
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  const { leseKontaktliste } = await import("@/lib/mail/kontaktlisten");
  type ScannerRunner = import("@/lib/leads/scanner").GebietsRunner;

  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });
  const keinPostfach = {
    neueste: async () => { throw new Error("kein Postfach im Test"); },
    eingang: async () => { throw new Error("kein Postfach im Test"); },
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
    return {
      csvPfad: pfad,
      ausgabe: `Gebietssuche "${auftrag.branche}" im Umkreis von ${auftrag.radiusKm} km um ${auftrag.mitte} (höchstens ${auftrag.maxAnfragen} Anfragen) …\nGebiet: 3 Betriebe, 2 mit E-Mail, 131 Anfragen\nCSV geschrieben: ${pfad}`,
    };
  };
  const heute = new Date("2026-09-30T10:00:00Z");

  const { feststellungAus } = await import("@/lib/leads/feststellung");
  const { fillMailTemplate } = await import("@/lib/mail/templates");

  const tests: Array<[string, () => Promise<void>]> = [
    [
      "Feststellung aus Scanner-Befunden: verständlichster zuerst, lesbar, nichts erfunden; ohne Befund fällt der Abschnitt weg",
      async () => {
        assert.equal(
          feststellungAus("keine Meta-Description; nur 4 Bewertungen (< 10); kein SSL/HTTPS"),
          "Ihr Google-Profil bisher nur 4 Bewertungen hat",
          "Standard: nur ein Befund, der verständlichste",
        );
        assert.equal(
          feststellungAus("keine Meta-Description; nur 4 Bewertungen (< 10); kein SSL/HTTPS", 2),
          "Ihr Google-Profil bisher nur 4 Bewertungen hat und Ihre Website ohne sichere HTTPS-Verbindung läuft",
        );
        assert.equal(
          feststellungAus("Website ohne LocalBusiness-Schema (JSON-LD); kein SSL/HTTPS", 2),
          "Ihre Website ohne sichere HTTPS-Verbindung läuft und sie Google keine strukturierten Firmendaten wie Adresse und Öffnungszeiten mitliefert",
        );
        assert.equal(feststellungAus("nur eine GMB-Kategorie gepflegt"), "in Ihrem Google-Unternehmensprofil nur eine Kategorie gepflegt ist");
        assert.equal(feststellungAus("Bewertungsschnitt 3.7 (< 4,0)"), "Ihr Bewertungsschnitt bei Google aktuell bei 3,7 Sternen liegt");
        assert.equal(feststellungAus("langsame Ladezeit (TTFB 2.4s > 1,5s)"), "Ihre Website erst nach 2,4 Sekunden antwortet");
        assert.equal(feststellungAus("Domain-Wechsel: a.de -> b.de; Redirect nicht auflösbar"), "");
        assert.equal(feststellungAus(""), "");
        // Optionaler Abschnitt: mit Befund drin (auch mitten im Absatz), ohne Befund fällt er ganz weg.
        const vorlage = "A {{firma}} ist da. {{#feststellung}}Dabei ist mir aufgefallen, dass **{{feststellung}}**. Das zählt.{{/feststellung}}\n\nB {{firma}}";
        const mit = fillMailTemplate(vorlage, { firma: "X", feststellung: feststellungAus("kein SSL/HTTPS") });
        assert.equal(mit.text, "A X ist da. Dabei ist mir aufgefallen, dass **Ihre Website ohne sichere HTTPS-Verbindung läuft**. Das zählt.\n\nB X");
        const ohne = fillMailTemplate(vorlage, { firma: "X", feststellung: feststellungAus("") });
        assert.equal(ohne.text, "A X ist da.\n\nB X");
        assert.deepEqual(ohne.fehlend, []);
        // Ein ganzer Absatz als Abschnitt hinterlässt keine Leerzeilen-Lücke.
        assert.equal(fillMailTemplate("A\n\n{{#f}}Satz {{f}}.{{/f}}\n\nB", {}).text, "A\n\nB");
        // Alte, gespeicherte Feststellung in einer Liste gilt nicht: beim Lesen frisch aus den Befunden.
        const { leseKontaktliste: lese } = await import("@/lib/mail/kontaktlisten");
        const dir = path.join(process.env.NOVA_HOME!, "kampagnen");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "alt.csv"), "firma;email;befunde;feststellung\nA;a@b.de;\"kein SSL/HTTPS; nur 2 Bewertungen (< 10)\";ALTER SATZ\n");
        assert.equal(lese("alt")[0]!.werte.feststellung, "Ihr Google-Profil bisher nur 2 Bewertungen hat");
        fs.rmSync(path.join(dir, "alt.csv"));
        // Pflicht-Platzhalter bleiben Pflicht.
        assert.deepEqual(fillMailTemplate(vorlage, {}).fehlend, ["firma"]);
      },
    ],
    ["Kundensuche ohne Freigabe: Rückfrage mit Kosten und Obergrenze, kein Lauf", async () => {
      const result = await run("kunden_suchen", { branche: "Schreinerei", ort: "Pforzheim", radius_km: 40, freigabe_id: "" });
      const data = result.data as { status: string; kosten_usd: number; max_kosten_usd: number };
      assert.equal(data.status, "freigabe_noetig");
      assert.equal(data.kosten_usd, schaetzeKosten(40).kostenUsd);
      assert.ok(data.kosten_usd > 3 && data.kosten_usd < 7, `40 km kosten etwa 3–7 $ (${data.kosten_usd})`);
      assert.ok(data.max_kosten_usd > data.kosten_usd);
      assert.ok(schaetzeKosten(10).kostenUsd < 1, "ein Ort mit 10 km ist billig");
      assert.equal(result.executed, false);
      assert.equal(await prisma.workItem.count({ where: { kind: "scanner.lauf" } }), 0);
    }],
    ["Freigabe gilt nur für genau diese Suche; danach Lauf im Hintergrund geplant", async () => {
      const frage = await run("kunden_suchen", { branche: "Schreinerei", ort: "Pforzheim", radius_km: 40, freigabe_id: "" });
      const freigabeId = (frage.data as { freigabe_id: string }).freigabe_id;
      const falsch = await run("kunden_suchen", { branche: "Schreinerei", ort: "Pforzheim", radius_km: 20, freigabe_id: freigabeId });
      assert.equal(falsch.ok, false, "anderer Umkreis = andere Suche");
      const richtig = await run("kunden_suchen", { branche: "Schreinerei", ort: "Pforzheim", radius_km: 40, freigabe_id: freigabeId });
      assert.equal((richtig.data as { status: string }).status, "gestartet");
      assert.equal(richtig.executed, true);
      const item = await prisma.workItem.findFirstOrThrow({ where: { kind: "scanner.lauf" } });
      assert.deepEqual(JSON.parse(item.payload), { branche: "Schreinerei", mitte: "Pforzheim", radiusKm: 40 });
      assert.equal(scannerAufrufe.length, 0, "Werkzeug startet den Scanner nicht selbst, das macht der Worker");
    }],
    ["Worker-Lauf: alle Betriebe in Vorrat, Firmen, Kontakte und Liste; Meldung mit ehrlichen Zahlen", async () => {
      const result = await fuehreGebietssucheAus({ organizationId: org.id, auftrag: { branche: "Schreinerei", mitte: "Pforzheim", radiusKm: 40 }, runner: testScanner, mx, heute });
      assert.equal(result.ok, true);
      assert.equal(scannerAufrufe.length, 1);
      assert.deepEqual(scannerAufrufe[0], { branche: "Schreinerei", mitte: "Pforzheim", radiusKm: 40, maxAnfragen: schaetzeKosten(40).maxAnfragen });
      const vorrat = await prisma.lead.findMany({ orderBy: { firma: "asc" } });
      assert.deepEqual(
        vorrat.map((lead) => [lead.firma, lead.status, lead.ort, lead.branche]),
        [
          ["Holzwerk Nord", "geprueft", "Mühlacker", "Schreinerei"],
          ["Möbelbau Süd", "verworfen", "Calw", "Schreinerei"],
          ["Schreinerei Zimmermann GmbH & Co.KG", "geprueft", "Pforzheim", "Schreinerei"],
        ],
      );
      const liste = leseKontaktliste("kunden-schreinerei-pforzheim-40km-2026-09-30").map((zeile) => zeile.werte);
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
      assert.match(meldungen[0]!.text, /Suche nach allen Schreinerei im Umkreis von 40 km um Pforzheim ist fertig: 3 Betriebe gefunden, 2 davon mit E-Mail\. 2 sind neu und geprüft im Vorrat/);
      assert.match(meldungen[0]!.text, /131 Google-Anfragen, etwa 4,59 \$\./, "Anfragen aus der Ergebniszeile, nicht aus der Obergrenze");
      const { naechsteBranche } = await import("@/services/tagesbetrieb/suchplan");
      const { leseEinstellungen } = await import("@/services/tagesbetrieb/einstellungen");
      assert.equal(naechsteBranche(leseEinstellungen()), "Zahnarztpraxis", "Suche auf Zuruf hakt die Branche im Suchplan des Tagesbetriebs ab");
      assert.equal(liste[1]!.ort, "Mühlacker");
      assert.equal(liste[1]!.entfernung_km, "12.3");
    }],
    ["Zweiter Lauf mit denselben Betrieben legt keine Firmen oder Kontakte doppelt an", async () => {
      const zweiter = await fuehreGebietssucheAus({ organizationId: org.id, auftrag: { branche: "Schreinerei", mitte: "Pforzheim", radiusKm: 40 }, runner: testScanner, mx, heute });
      assert.equal(zweiter.ok && zweiter.neuImVorrat, 0, "nichts doppelt im Vorrat");
      assert.equal(await prisma.lead.count(), 3);
      assert.equal(await prisma.company.count({ where: { organizationId: org.id } }), 3);
      assert.equal(await prisma.contact.count({ where: { organizationId: org.id } }), 3);
      await holeNeueMeldungen(org.id);
    }],
    ["Scanner-Fehler wird ehrlich gemeldet", async () => {
      const kaputt: ScannerRunner = async () => { throw new Error("Places-Key ungültig"); };
      const result = await fuehreGebietssucheAus({ organizationId: org.id, auftrag: { branche: "Maler", mitte: "Calw", radiusKm: 10 }, runner: kaputt, mx });
      assert.equal(result.ok, false);
      const meldungen = await holeNeueMeldungen(org.id);
      assert.match(meldungen[0]!.text, /Suche nach allen Maler im Umkreis von 10 km um Calw ist fehlgeschlagen: Places-Key ungültig/);
    }],
    ["Dauerfreigabe Scanner mit Tageslimit: erster Lauf ohne Rückfrage, dann wieder Rückfrage", async () => {
      await prisma.workItem.deleteMany({ where: { kind: "scanner.lauf" } });
      await run("freigabe_scanner_dauer", { aktion: "erteilen", max_pro_tag: 1 });
      const erster = await run("kunden_suchen", { branche: "Elektriker", ort: "Calw", radius_km: 10, freigabe_id: "" });
      assert.equal((erster.data as { status: string }).status, "gestartet");
      const zweiter = await run("kunden_suchen", { branche: "Elektriker", ort: "Nagold", radius_km: 10, freigabe_id: "" });
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
