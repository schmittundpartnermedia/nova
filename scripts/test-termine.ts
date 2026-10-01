/**
 * Regressionstest Termine – ohne Netz, ohne Apple Kalender (Kalender im Speicher), Wegwerf-DB.
 * Geprüft: Anlegen mit/ohne Kalender, Erinnerung über den echten Worker-Takt zur richtigen Zeit und nur einmal,
 * Verschieben (alte Erinnerung fällt weg, Kalender angepasst), Absagen (aus dem Kalender), Kalenderfehler ehrlich,
 * Vergangenheit abgelehnt, AppleScript sicher, Termine im Tagesüberblick.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-termine-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.NOVA_HOME = path.join(tmp, "home");

async function main() {
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { env: process.env, encoding: "utf8" });
  if (push.status !== 0) throw new Error(push.stderr);
  const { prisma } = await import("@/lib/prisma");
  const { setzeKalender, eintragScript, aenderScript, kalenderScriptSicher } = await import("@/lib/kalender/apple");
  const { legeTerminAn, aendereTermin } = await import("@/services/termine");
  const { tickWorker } = await import("@/services/worker/runtime");
  const { executeTool } = await import("@/services/tools/registry");
  const { tagesueberblick } = await import("@/services/ueberblick");
  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });

  // Kalender im Speicher; kaputt = true simuliert fehlende macOS-Freigabe.
  const eintraege = new Map<string, { titel: string; beginn: Date }>();
  let kaputt = false;
  let nr = 0;
  setzeKalender({
    async eintragen(e) {
      if (kaputt) return { ok: false, grund: "NOVA darf den Kalender noch nicht steuern." };
      const uid = `uid-${++nr}`;
      eintraege.set(uid, { titel: e.titel, beginn: e.beginn });
      return { ok: true, kalender: "Arbeit", uid };
    },
    async aendern(ort, e) {
      if (!eintraege.has(ort.uid)) return { ok: false, grund: "Eintrag nicht mehr im Kalender" };
      eintraege.set(ort.uid, { titel: e.titel, beginn: e.beginn });
      return { ok: true, kalender: ort.kalender, uid: ort.uid };
    },
    async entfernen(ort) {
      eintraege.delete(ort.uid);
      return { ok: true };
    },
  });

  // Fester „Jetzt“: Mittwoch, 7. Oktober 2026, 9:00 (Zeit des Macs).
  const jetzt = new Date(2026, 9, 7, 9, 0);
  const donnerstag10 = new Date(2026, 9, 8, 10, 0);
  const meldungen = async () =>
    (await prisma.conversationMessage.findMany({ where: { organizationId: org.id, metadata: { contains: "nova-meldung" } }, orderBy: { createdAt: "asc" } })).map((m) => m.content);
  const offeneErinnerungen = () => prisma.workItem.findMany({ where: { organizationId: org.id, kind: "termin.erinnerung", status: "queued" } });

  let weberId = "";
  const tests: Array<[string, () => Promise<void>]> = [
    ["Anlegen mit Kalender: gespeichert, im Kalender, Erinnerung 15 Minuten vorher geplant", async () => {
      const r = await legeTerminAn({ organizationId: org.id, titel: "Rückruf Schreinerei Weber", beginn: donnerstag10, notiz: "Herr Weber, 07231 12345", inKalender: true, jetzt });
      weberId = r.termin.id;
      assert.match(r.kalender, /Apple Kalender „Arbeit“/);
      assert.equal(eintraege.size, 1);
      const items = await offeneErinnerungen();
      assert.equal(items.length, 1);
      assert.equal(items[0]!.runAt.getTime(), donnerstag10.getTime() - 15 * 60_000);
      assert.match(r.termin.wann, /^Donnerstag, 8\. Oktober, 10:00 Uhr$/);
    }],
    ["Erinnerung über den Worker: vorher nichts, zur Zeit genau eine Meldung", async () => {
      await tickWorker("test", new Date(donnerstag10.getTime() - 16 * 60_000));
      assert.equal((await meldungen()).length, 0, "eine Minute zu früh darf nichts kommen");
      await tickWorker("test", new Date(donnerstag10.getTime() - 15 * 60_000));
      const m = await meldungen();
      assert.equal(m.length, 1);
      assert.equal(m[0], "In 15 Minuten: Rückruf Schreinerei Weber.");
      const notiz = await prisma.conversationMessage.findFirstOrThrow({ where: { organizationId: org.id, content: m[0]! } });
      assert.match(notiz.metadata ?? "", /Notiz: Herr Weber, 07231 12345/, "Notiz bleibt im Verlauf");
      await tickWorker("test", new Date(donnerstag10.getTime() - 5 * 60_000));
      assert.equal((await meldungen()).length, 1, "keine Doppelmeldung");
      const t = await prisma.termin.findUniqueOrThrow({ where: { id: weberId } });
      assert.equal(t.status, "erinnert");
      // Worker kam zu spät (Mac schlief): ehrlich „verpasst“, nicht „jetzt“.
      const spaet = await legeTerminAn({ organizationId: org.id, titel: "Rückruf Bäckerei Gold", beginn: new Date(2026, 9, 8, 12, 0), inKalender: false, jetzt });
      await tickWorker("test", new Date(2026, 9, 8, 13, 0));
      assert.match((await meldungen()).at(-1)!, /^Verpasst, war Donnerstag, 8\. Oktober, 12:00 Uhr: Rückruf Bäckerei Gold\.$/);
      await aendereTermin({ organizationId: org.id, id: spaet.termin.id, status: "erledigt", jetzt });
    }],
    ["Verschieben: alte Erinnerung entfällt, neue geplant, Kalender angepasst, wieder offen", async () => {
      const r1 = await legeTerminAn({ organizationId: org.id, titel: "Rückruf Malerei Kurz", beginn: new Date(2026, 9, 9, 14, 0), inKalender: true, jetzt });
      const neu = new Date(2026, 9, 12, 11, 30);
      const r2 = await aendereTermin({ organizationId: org.id, id: r1.termin.id, beginn: neu, jetzt });
      assert.match(r2.kalender, /angepasst/);
      assert.equal([...eintraege.values()].find((e) => e.titel === "Rückruf Malerei Kurz")!.beginn.getTime(), neu.getTime());
      const items = (await offeneErinnerungen()).filter((i) => i.payload.includes(r1.termin.id));
      assert.equal(items.length, 1);
      assert.equal(items[0]!.runAt.getTime(), neu.getTime() - 15 * 60_000);
      // Die alte Zeit vergeht: keine Meldung.
      const vorher = (await meldungen()).length;
      await tickWorker("test", new Date(2026, 9, 9, 13, 50));
      assert.equal((await meldungen()).length, vorher);
      // Ein schon erinnerter Termin, der verschoben wird, ist wieder offen.
      const w = await aendereTermin({ organizationId: org.id, id: weberId, beginn: new Date(2026, 9, 13, 9, 0), jetzt });
      assert.equal(w.termin.status, "geplant");
    }],
    ["Absagen: aus dem Kalender entfernt, keine Erinnerung mehr", async () => {
      const r = await aendereTermin({ organizationId: org.id, id: weberId, status: "abgesagt", jetzt });
      assert.match(r.kalender, /entfernt/);
      assert.equal([...eintraege.values()].some((e) => e.titel === "Rückruf Schreinerei Weber"), false);
      assert.equal((await offeneErinnerungen()).some((i) => i.payload.includes(weberId)), false);
    }],
    ["Kalender verweigert: Termin trotzdem gespeichert und erinnert, Grund wird genannt", async () => {
      kaputt = true;
      const r = await executeTool(
        "termin_anlegen",
        { titel: "Rückruf Elektro Maier", beginn: "2026-10-08T16:00", dauer_minuten: null, notiz: null, erinnerung_minuten: 30, in_kalender: true, quelle_id: null },
        { organizationId: org.id, postfach: {} as never },
      );
      kaputt = false;
      assert.equal(r.ok, true);
      assert.equal(r.executed, true);
      const data = r.data as { termin: { id: string; imKalender: string | null }; kalender: string };
      assert.match(data.kalender, /nicht im Apple Kalender: NOVA darf den Kalender noch nicht steuern/);
      assert.equal(data.termin.imKalender, null);
      const items = (await offeneErinnerungen()).filter((i) => i.payload.includes(data.termin.id));
      assert.equal(items.length, 1);
      assert.equal(items[0]!.runAt.getTime(), new Date(2026, 9, 8, 15, 30).getTime());
    }],
    ["Vergangenheit und unlesbare Zeit werden abgelehnt, nichts gespeichert", async () => {
      const vorher = await prisma.termin.count();
      await assert.rejects(legeTerminAn({ organizationId: org.id, titel: "X", beginn: new Date(2026, 9, 6, 10, 0), inKalender: true, jetzt }), /Vergangenheit/);
      const r = await executeTool(
        "termin_anlegen",
        { titel: "X", beginn: "Donnerstag", dauer_minuten: null, notiz: null, erinnerung_minuten: null, in_kalender: false, quelle_id: null },
        { organizationId: org.id, postfach: {} as never },
      );
      assert.equal(r.ok, false);
      assert.equal(await prisma.termin.count(), vorher);
    }],
    ["AppleScript: Datum aus Bestandteilen, Text sicher zitiert, fremde Befehle abgelehnt", async () => {
      const e = { titel: 'Rückruf "Weber" \\ Co', beginn: new Date(2026, 9, 8, 10, 0), dauerMinuten: 30, notiz: "Zeile 1\nZeile 2", erinnerungMinuten: 15 };
      const s = eintragScript(e, null);
      assert.ok(s.includes("set year of beginnDatum to 2026") && s.includes("set month of beginnDatum to 10") && s.includes("set day of beginnDatum to 8"));
      assert.ok(s.includes(`set time of beginnDatum to ${10 * 3600}`) && s.includes(`set time of endeDatum to ${10 * 3600 + 30 * 60}`));
      assert.ok(s.includes('summary:"Rückruf \\"Weber\\" \\\\ Co"'));
      assert.ok(s.includes('description:"Zeile 1\\nZeile 2"'));
      assert.ok(s.includes("trigger interval:-15"));
      assert.equal(kalenderScriptSicher(s), true);
      assert.equal(kalenderScriptSicher(aenderScript({ kalender: "Arbeit", uid: "u" }, e)), true);
      assert.equal(kalenderScriptSicher(eintragScript({ ...e, titel: "x do shell script y" }, null)), false);
      assert.equal(kalenderScriptSicher('tell application "Calendar"\n tell application "Mail" to quit\nend tell'), false);
    }],
    ["Tagesüberblick nennt die offenen Termine von heute und morgen", async () => {
      const heute = new Date();
      const spaeter = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate(), 23, 50);
      const ziel = spaeter > heute ? spaeter : new Date(heute.getTime() + 3600_000);
      await legeTerminAn({ organizationId: org.id, titel: "Rückruf Dachdecker Roth", beginn: ziel, inKalender: false });
      const postfach = { neueste: async () => [], eingang: async () => [], lesen: async () => null, senden: async () => ({ ok: false as const, executed: false as const, grund: "" }), antworten: async () => ({ ok: false as const, executed: false as const, grund: "" }) };
      const u = await tagesueberblick({ organizationId: org.id, postfach, checkQuelle: async () => ({ eingerichtet: true, checks: [] }) });
      const titel = u.wartet_auf_dich.termine_heute_und_morgen.map((t) => t.titel);
      assert.ok(titel.includes("Rückruf Dachdecker Roth"));
      assert.ok(!titel.includes("Rückruf Schreinerei Weber"), "abgesagte Termine nicht");
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
  setzeKalender(null);
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
