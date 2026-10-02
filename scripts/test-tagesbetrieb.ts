/**
 * Regressionstest Kunden-Tagesbetrieb – spielt einen Arbeitstag mit festen Uhrzeiten durch.
 * Ohne Lead-Scanner-API, ohne Apple Mail, ohne DNS: Test-Tageslauf, Test-Postfach, Test-MX. Wegwerf-DB und -NOVA_HOME.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wegwerfDatenbank } from "./lib/wegwerf-db";

// Deutsche Zeit wie auf dem Server (pm2: TZ=Europe/Berlin), unabhängig vom Rechner, auf dem der Test läuft.
process.env.TZ = "Europe/Berlin";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-tagesbetrieb-"));
process.env.NOVA_HOME = path.join(tmp, "home");
// Die Check-Zählung fragt die echte App ab; im Test nie.
delete process.env.RANKPILOT_CHECKS_TOKEN;

// Ausgabe der Gebietssuche (lead-scanner/src/gebiet.ts)
const GEBIET_CSV = [
  "placeId,name,inhaberName,ansprechpartner,telefon,email,adresse,ort,entfernungKm,website,finalUrl,rating,reviewCount,score,befunde,aufhaenger",
  "p1,Holz Maier,Anton Maier,Anton Maier,0721 1,info@holz-maier.de,Str 1,Pforzheim,1.0,https://holz-maier.de,https://holz-maier.de/,4.5,10,70,kein SSL,Aufhänger 1",
  "p2,Tischlerei Nord,,,0721 2,kontakt@tischlerei-nord.de,Str 2,Pforzheim,2.0,https://tischlerei-nord.de,https://tischlerei-nord.de/,4.1,3,60,keine Meta-Description,Aufhänger 2",
  "p3,Ohne Mail GmbH,,,0721 3,,Str 3,Pforzheim,3.0,,,3.9,1,90,keine Website,Aufhänger 3",
  "p4,Tote Domain,,,0721 4,info@tot.de,Str 4,Pforzheim,4.0,https://tot.de,https://tot.de/,4.0,2,80,x,y",
  "p5,Gesperrt AG,,,0721 5,info@gesperrt.de,Str 5,Pforzheim,5.0,https://gesperrt.de,https://gesperrt.de/,4.0,2,85,x,y",
  "p6,Schon Kunde,,,0721 6,hallo@schon.de,Str 6,Pforzheim,6.0,https://schon.de,https://schon.de/,4.0,2,50,x,y",
  "p7,Dritte Werkstatt,Eva Kurz,Eva Kurz,0721 7,eva@werkstatt3.de,Str 7,Mühlacker,12.0,https://werkstatt3.de,https://werkstatt3.de/,4.9,40,40,wenig Bewertungen,Aufhänger 7",
].join("\n");

// Der Test spielt den HEUTIGEN Tag durch (die Datenbank stempelt mit der echten Uhrzeit); Wochentage werden passend gesetzt.
const heute = new Date();
const t = (stunde: number, minute: number) => new Date(heute.getFullYear(), heute.getMonth(), heute.getDate(), stunde, minute);
const heuteWochentag = heute.getDay() === 0 ? 7 : heute.getDay();

async function main() {
  wegwerfDatenbank();

  const home = process.env.NOVA_HOME!;
  const { prisma } = await import("@/lib/prisma");
  const { executeTool } = await import("@/services/tools/registry");
  const { tagesbetriebTick } = await import("@/services/tagesbetrieb");
  const { fuehreGebietssucheAus } = await import("@/services/leads");
  const { leseEinstellungen } = await import("@/services/tagesbetrieb/einstellungen");
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  type Postfach = import("@/services/mail/postfach").Postfach;

  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });
  const gesendet: string[] = [];
  let scheitertAn: string | null = null;
  const postfach: Postfach = {
    neueste: async () => [],
    eingang: async () => [],
    lesen: async () => null,
    senden: async (input) => {
      if (input.an === scheitertAn) return { ok: false, executed: false, grund: "Adresse abgelehnt." };
      gesendet.push(input.an);
      return { ok: true, executed: true, messageId: `<${gesendet.length}@t>`, grund: "Im Ordner Gesendet gefunden." };
    },
    antworten: async () => ({ ok: false, executed: false, grund: "nicht im Test" }),
  };
  const mx = async (domain: string) => domain !== "tot.de";
  const ctx = { organizationId: org.id, postfach };
  const run = (name: string, args: Record<string, unknown>) => executeTool(name, args, ctx);
  const tick = (jetzt: Date) => tagesbetriebTick({ organizationId: org.id, jetzt, postfach, mx });
  const suchAuftraege: unknown[] = [];
  const runner: import("@/lib/leads/scanner").GebietsRunner = async (auftrag) => {
    suchAuftraege.push(auftrag);
    const pfad = path.join(tmp, `gebiet-${Date.now()}.csv`);
    fs.writeFileSync(pfad, GEBIET_CSV);
    return { csvPfad: pfad, ausgabe: `Gebiet: 7 Betriebe, 6 mit E-Mail, 120 Anfragen\nCSV geschrieben: ${pfad}` };
  };
  const { naechsteBranche } = await import("@/services/tagesbetrieb/suchplan");
  const sucheGebiet = (branche: string) =>
    fuehreGebietssucheAus({ organizationId: org.id, auftrag: { branche, mitte: "Pforzheim", radiusKm: 40 }, runner, mx });

  const tests: Array<[string, () => Promise<void>]> = [
    ["Ausgeschaltet: der Takt tut nichts und plant sich nicht neu", async () => {
      const result = await tick(t(9, 0));
      assert.deepEqual(result, { weiter: false, aktion: "ausgeschaltet" });
    }],
    ["Einschalten per Werkzeug: Einstellungen mit Standardwerten (50/Tag, 5 Min., 08–17 Uhr), erster Takt geplant", async () => {
      const result = await run("tagesbetrieb", { aktion: "einschalten", max_pro_tag: 0, abstand_minuten: 0, start: "", ende: "", vorlage: "" });
      assert.equal(result.ok, true, result.error);
      assert.deepEqual(leseEinstellungen().wochentage, [1, 2, 3, 4, 5], "Standard Mo–Fr");
      fs.writeFileSync(path.join(home, "tagesbetrieb.json"), JSON.stringify({ ...leseEinstellungen(), wochentage: [heuteWochentag] }));
      const cfg = leseEinstellungen();
      assert.equal(cfg.aktiv, true);
      assert.equal(cfg.maxProTag, 50);
      assert.equal(cfg.start, "08:00");
      assert.equal(cfg.organizationId, org.id);
      assert.equal(await prisma.workItem.count({ where: { kind: "tagesbetrieb.tick" } }), 1);
    }],
    ["Ohne Kunden-Vorlage: einmal melden, nichts suchen, nichts senden", async () => {
      assert.equal((await tick(t(7, 30))).aktion, "vorlage fehlt");
      assert.equal((await tick(t(7, 35))).aktion, "vorlage fehlt");
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.length, 1);
      assert.match(meldungen[0]!.text, /Vorlage „kunden“ fehlt/);
    }],
    ["Vorrat leer: NOVA schlägt die nächste Branche mit Kosten vor und sucht NICHT selbst – auch mit Dauerfreigabe", async () => {
      fs.mkdirSync(path.join(home, "vorlagen"), { recursive: true });
      fs.writeFileSync(path.join(home, "vorlagen", "kunden.md"), "Betreff: Mehr Sichtbarkeit für {{firma}}\n\n{{anrede}},\n\nbei {{firma}} in {{ort}} ist uns aufgefallen: {{befunde}}.\n");
      await run("freigabe_scanner_dauer", { aktion: "erteilen", max_pro_tag: 5 });
      await tick(t(7, 40));
      await tick(t(7, 45));
      assert.equal(await prisma.workItem.count({ where: { kind: "scanner.lauf" } }), 0, "keine Suche ohne Joachims Ja");
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.length, 1, "Vorschlag nur einmal");
      assert.match(meldungen[0]!.text, /Im Vorrat für den Tagesbetrieb ist kein Betrieb mehr\. Als Nächstes würde ich alle Betriebe der Branche „Schreinerei“ im Umkreis von 40 km um Pforzheim suchen, etwa [\d,]+ \$, höchstens [\d,]+ \$\. Soll ich das machen, oder lieber eine andere Branche\?/);
      const gespeichert = await prisma.conversationMessage.findFirstOrThrow({ where: { id: meldungen[0]!.id } });
      assert.match(gespeichert.metadata ?? "", /freigabe_id/, "Freigabe geht im Werkzeugprotokoll mit");
    }],
    ["Joachims Ja zum Vorschlag startet genau diese Gebietssuche", async () => {
      const meldung = await prisma.conversationMessage.findFirstOrThrow({ where: { content: { contains: "Als Nächstes würde ich" } } });
      const freigabeId = String(JSON.parse(meldung.metadata ?? "{}").werkzeuge).match(/"freigabe_id":"([^"]+)"/)![1]!;
      await run("freigabe_scanner_dauer", { aktion: "widerrufen", max_pro_tag: 0 });
      const ja = await run("kunden_suchen", { branche: "Schreinerei", ort: "Pforzheim", radius_km: 40, freigabe_id: freigabeId });
      assert.equal((ja.data as { status: string }).status, "gestartet", ja.error);
      const auftrag = await prisma.workItem.findFirstOrThrow({ where: { kind: "scanner.lauf" } });
      assert.deepEqual(JSON.parse(auftrag.payload), { branche: "Schreinerei", mitte: "Pforzheim", radiusKm: 40 });
      // Solange die Suche läuft, schlägt NOVA nichts Neues vor.
      await tick(t(7, 50));
      assert.equal((await holeNeueMeldungen(org.id)).length, 0);
    }],
    ["Suche + Prüfung: ganze Branche im Suchgebiet, gültige Adressen geprüft, andere mit Grund verworfen, Branche abgehakt", async () => {
      fs.mkdirSync(path.join(home, "kampagnen"), { recursive: true });
      fs.writeFileSync(path.join(home, "kampagnen", "sperrliste.txt"), "@gesperrt.de  # will keine Mails\n");
      await prisma.communication.create({
        data: { organizationId: org.id, channel: "email", direction: "outbound", subject: "alt", body: "alt", status: "sent", toAddress: "hallo@schon.de", sentAt: new Date(Date.now() - 20 * 86_400_000) },
      });
      const result = await sucheGebiet("Schreinerei");
      assert.equal(result.ok, true);
      assert.deepEqual(suchAuftraege[0], { branche: "Schreinerei", mitte: "Pforzheim", radiusKm: 40, maxAnfragen: (await import("@/lib/leads/scanner")).schaetzeKosten(40).maxAnfragen });
      assert.equal(result.ok && result.gefunden, 7);
      assert.equal(result.ok && result.anfragen, 120);
      assert.equal(naechsteBranche(leseEinstellungen()), "Zahnarztpraxis", "Schreinerei ist im Suchplan abgehakt");
      // wie der Worker: geplanten Auftrag mit Ergebnis-Notiz abschließen
      const { completeWorkItem } = await import("@/services/worker/queue");
      const auftrag = await prisma.workItem.findFirstOrThrow({ where: { kind: "scanner.lauf" } });
      await completeWorkItem(auftrag.id, org.id, "7 Betriebe, 3 neu im Vorrat, 120 Anfragen → liste");
      const leads = await prisma.lead.findMany({ orderBy: { firma: "asc" } });
      const nachFirma = Object.fromEntries(leads.map((lead) => [lead.firma, [lead.status, lead.grund]]));
      assert.deepEqual(nachFirma["Holz Maier"], ["geprueft", null]);
      assert.deepEqual(nachFirma["Tischlerei Nord"], ["geprueft", null]);
      assert.deepEqual(nachFirma["Dritte Werkstatt"], ["geprueft", null]);
      assert.deepEqual(nachFirma["Ohne Mail GmbH"], ["verworfen", "keine E-Mail-Adresse"]);
      assert.deepEqual(nachFirma["Tote Domain"], ["verworfen", "Domain tot.de nimmt keine Mail an"]);
      assert.deepEqual(nachFirma["Gesperrt AG"], ["verworfen", "steht auf der Sperrliste"]);
      assert.deepEqual(nachFirma["Schon Kunde"], ["verworfen", "wurde schon angeschrieben"]);
      const nochmal = await sucheGebiet("Schreinerei");
      assert.equal(nochmal.ok && nochmal.neuImVorrat, 0, "gleiche Adressen werden nicht doppelt eingelesen");
    }],
    ["Zurückgestellter Betrieb wird wieder aufgenommen, wenn der Scanner ihn in seiner Branche wiederfindet", async () => {
      const maier = await prisma.lead.findFirstOrThrow({ where: { firma: "Holz Maier" } });
      await prisma.lead.update({ where: { id: maier.id }, data: { status: "zurueckgestellt", grund: "Branche kommt später" } });
      const wieder = await sucheGebiet("Schreinerei");
      assert.equal(wieder.ok && wieder.neuImVorrat, 1, "nur der zurückgestellte Betrieb kommt neu in den Vorrat");
      const danach = await prisma.lead.findUniqueOrThrow({ where: { id: maier.id } });
      assert.deepEqual([danach.status, danach.grund], ["geprueft", null]);
      assert.equal(await prisma.lead.count({ where: { firma: "Holz Maier" } }), 1, "kein zweiter Eintrag");
      await holeNeueMeldungen(org.id);
    }],
    ["Morgens: Tageskampagne mit EINER Beispiel-Mail zur Freigabe vorgelegt, nichts gesendet", async () => {
      await holeNeueMeldungen(org.id);
      assert.equal((await tick(t(7, 55))).aktion, "freigabe vorgelegt");
      const kampagne = await prisma.campaign.findFirstOrThrow({ where: { art: "tagesbetrieb" } });
      assert.equal(kampagne.status, "wartet_auf_freigabe");
      const entwuerfe = await prisma.communication.findMany({ where: { campaignId: kampagne.id } });
      assert.equal(entwuerfe.length, 1);
      assert.equal(entwuerfe[0]!.toAddress, "info@holz-maier.de", "Lead mit höchstem Score zuerst");
      assert.equal(entwuerfe[0]!.subject, "Mehr Sichtbarkeit für Holz Maier");
      assert.equal(entwuerfe[0]!.body, "Guten Tag Anton Maier,\n\nbei Holz Maier in Pforzheim ist uns aufgefallen: kein SSL.");
      const alle = await holeNeueMeldungen(org.id);
      // Nur noch 3 im Vorrat (< 5): zusätzlich der Vorschlag für die nächste Branche – gesucht wird nicht.
      const vorschlag = alle.filter((m) => /Als Nächstes würde ich/.test(m.text));
      assert.equal(vorschlag.length, 1);
      assert.match(vorschlag[0]!.text, /Durchsucht sind bisher: Schreinerei\. Als Nächstes würde ich alle Betriebe der Branche „Zahnarztpraxis“/);
      const meldungen = alle.filter((m) => !/Als Nächstes würde ich/.test(m.text));
      assert.equal(meldungen.length, 1);
      assert.match(meldungen[0]!.text, /bis zu 50 Mails .* 08:00–17:00 Uhr, alle 5 Minuten/);
      const zeile = await prisma.conversationMessage.findFirstOrThrow({ where: { id: meldungen[0]!.id } });
      assert.match(zeile.metadata ?? "", /freigabe_id/);
      assert.equal((await tick(t(8, 5))).aktion, "kampagne wartet_auf_freigabe");
      assert.equal(gesendet.length, 0);
    }],
    ["Freigabe nur mit der richtigen ID; danach eine Mail pro Takt im Abstand", async () => {
      const falsch = await run("tagesbetrieb_freigeben", { freigabe_id: "falsch" });
      assert.equal(falsch.ok, false);
      const kampagne = await prisma.campaign.findFirstOrThrow({ where: { art: "tagesbetrieb" } });
      const ok = await run("tagesbetrieb_freigeben", { freigabe_id: kampagne.approvalId });
      assert.equal(ok.ok, true, ok.error);
      assert.equal((await tick(t(8, 10))).aktion, "gesendet");
      assert.deepEqual(gesendet, ["info@holz-maier.de"]);
      assert.equal((await prisma.lead.findFirstOrThrow({ where: { firma: "Holz Maier" } })).status, "angeschrieben");
      assert.equal((await tick(t(8, 12))).aktion, "abstand");
      assert.equal((await tick(t(8, 15))).aktion, "gesendet");
      assert.deepEqual(gesendet, ["info@holz-maier.de", "kontakt@tischlerei-nord.de"]);
      assert.equal(await prisma.workItem.count({ where: { kind: "postfach.wache" } }) >= 1, true, "Antwort-Wache geplant");
    }],
    ["Fehlgeschlagener Versand: Lead mit Grund verworfen, Mail als fehlgeschlagen", async () => {
      scheitertAn = "eva@werkstatt3.de";
      assert.match((await tick(t(8, 20))).aktion, /fehlgeschlagen/);
      scheitertAn = null;
      const lead = await prisma.lead.findFirstOrThrow({ where: { firma: "Dritte Werkstatt" } });
      assert.equal(lead.status, "verworfen");
      assert.match(lead.grund ?? "", /Versand fehlgeschlagen: Adresse abgelehnt/);
      assert.equal((await tick(t(8, 25))).aktion, "keine geprüfte Adresse im Vorrat");
    }],
    ["Tageslimit wird eingehalten", async () => {
      fs.writeFileSync(path.join(home, "tagesbetrieb.json"), JSON.stringify({ ...leseEinstellungen(), maxProTag: 2 }));
      await prisma.lead.create({ data: { organizationId: org.id, firma: "Noch einer", anrede: "Sehr geehrtes Noch-einer-Team", email: "a@noch-einer.de", ort: "Pforzheim", befunde: "x", quelle: "test", status: "geprueft" } });
      assert.equal((await tick(t(8, 30))).aktion, "tageslimit erreicht");
      assert.equal(gesendet.length, 2);
    }],
    ["Feierabend: Kampagne fertig, Tagesbericht einmal – als Datei und im Chat", async () => {
      await holeNeueMeldungen(org.id);
      assert.equal((await tick(t(17, 5))).aktion, "tagesbericht");
      assert.equal((await prisma.campaign.findFirstOrThrow({ where: { art: "tagesbetrieb" } })).status, "fertig");
      const datum = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`;
      const datei = path.join(home, "berichte", `${datum}.md`);
      const bericht = fs.readFileSync(datei, "utf8");
      assert.match(bericht, /2 Mails gesendet, 1 fehlgeschlagen/);
      assert.ok(bericht.includes(`| 08:10 | Holz Maier | info@holz-maier.de | Mehr Sichtbarkeit für Holz Maier | Kunden-Tagesbetrieb ${datum} |`));
      assert.match(bericht, /1 Kundensuchen|2 Kundensuchen/);
      assert.match(bericht, /Google-Kosten: etwa 4,20 \$ \(120 Anfragen/);
      assert.match(bericht, /1 × Domain tot.de nimmt keine Mail an/);
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.length, 1);
      assert.ok(meldungen[0]!.text.startsWith(`Tagesbericht ${datum}: 2 Mails gesendet`));
      assert.equal((await tick(t(17, 10))).aktion, "ausserhalb");
      assert.equal((await holeNeueMeldungen(org.id)).length, 0);
    }],
    ["Alle Branchen im Gebiet durchsucht: kein Vorschlag mehr, einmal melden", async () => {
      await holeNeueMeldungen(org.id);
      fs.writeFileSync(path.join(home, "tagesbetrieb.json"), JSON.stringify({ ...leseEinstellungen(), branchen: ["Schreinerei"], vorratMindestens: 999 }));
      const suchenVorher = await prisma.workItem.count({ where: { kind: "scanner.lauf" } });
      await tick(t(16, 0));
      await tick(t(16, 5));
      assert.equal(await prisma.workItem.count({ where: { kind: "scanner.lauf" } }), suchenVorher);
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.length, 1);
      assert.match(meldungen[0]!.text, /Alle 1 Branchen im Umkreis von 40 km um Pforzheim sind durchsucht/);
      fs.writeFileSync(path.join(home, "tagesbetrieb.json"), JSON.stringify({ ...leseEinstellungen(), branchen: undefined, vorratMindestens: 5 }));
    }],
    ["Kein Arbeitstag: nichts passiert", async () => {
      const vorher = gesendet.length;
      const kampagnen = await prisma.campaign.count();
      fs.writeFileSync(path.join(home, "tagesbetrieb.json"), JSON.stringify({ ...leseEinstellungen(), wochentage: [((heuteWochentag % 7) + 1)] }));
      assert.equal((await tick(t(10, 0))).aktion, "ausserhalb");
      assert.equal(await prisma.campaign.count(), kampagnen);
      assert.equal(gesendet.length, vorher);
    }],
    ["Dauerfreigabe (taegliche_freigabe nein): Tageskampagne startet morgens von selbst, Joachim wird informiert, ab 8 Uhr wird gesendet", async () => {
      await holeNeueMeldungen(org.id);
      fs.writeFileSync(path.join(home, "tagesbetrieb.json"), JSON.stringify({ ...leseEinstellungen(), wochentage: [1, 2, 3, 4, 5, 6, 7] }));
      const an = await run("tagesbetrieb", { aktion: "einschalten", max_pro_tag: 0, abstand_minuten: 0, start: "", ende: "", vorlage: "", taegliche_freigabe: "nein" });
      assert.equal(an.ok, true, an.error);
      assert.equal(leseEinstellungen().taeglicheFreigabe, false);
      const m = (h: number, min: number) => new Date(heute.getFullYear(), heute.getMonth(), heute.getDate() + 1, h, min);
      assert.equal((await tick(m(7, 55))).aktion, "gestartet (Dauerfreigabe)");
      const kampagne = await prisma.campaign.findFirstOrThrow({ where: { art: "tagesbetrieb", status: "laeuft" } });
      const freigabe = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: kampagne.approvalId! } });
      assert.equal(freigabe.status, "approved");
      assert.match(freigabe.description, /Dauerfreigabe für den Tagesbetrieb/);
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.filter((x) => /^Kunden-Tagesbetrieb läuft: bis zu 2 Mails/.test(x.text)).length, 1);
      assert.ok(!meldungen.some((x) => /Soll ich heute so starten/.test(x.text)), "keine Frage mehr");
      const vorher = gesendet.length;
      assert.equal((await tick(m(8, 0))).aktion, "gesendet");
      assert.equal(gesendet.length, vorher + 1);
      assert.equal(gesendet.at(-1), "a@noch-einer.de");
      const zurueck = await run("tagesbetrieb", { aktion: "einschalten", max_pro_tag: 0, abstand_minuten: 0, start: "", ende: "", vorlage: "", taegliche_freigabe: "ja" });
      assert.equal(zurueck.ok, true);
      assert.equal(leseEinstellungen().taeglicheFreigabe, true, "per Stimme zurückstellbar");
    }],
    ["Ausschalten per Werkzeug", async () => {
      await run("tagesbetrieb", { aktion: "ausschalten", max_pro_tag: 0, abstand_minuten: 0, start: "", ende: "", vorlage: "" });
      assert.deepEqual(await tick(t(9, 0)), { weiter: false, aktion: "ausgeschaltet" });
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
