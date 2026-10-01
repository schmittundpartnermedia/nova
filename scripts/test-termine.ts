/**
 * Regressionstest Termine – ohne Netz, ohne echten Kalender (Kalender im Speicher), Wegwerf-DB.
 * Geprüft: Anlegen mit/ohne Kalender, Erinnerung über den echten Worker-Takt zur richtigen Zeit und nur einmal,
 * Verschieben (alte Erinnerung fällt weg, Kalender angepasst), Absagen (aus dem Kalender), Kalenderfehler ehrlich,
 * Vergangenheit abgelehnt, CalDAV-Eintrag (iCalendar), Termine im Tagesüberblick.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wegwerfDatenbank } from "./lib/wegwerf-db";

// Deutsche Zeit wie auf dem Server (pm2: TZ=Europe/Berlin), unabhängig vom Rechner, auf dem der Test läuft.
process.env.TZ = "Europe/Berlin";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-termine-"));
process.env.NOVA_HOME = path.join(tmp, "home");

async function main() {
  wegwerfDatenbank();
  const { prisma } = await import("@/lib/prisma");
  const { setzeKalender } = await import("@/lib/kalender");
  const { baueCaldavKalender, ics } = await import("@/lib/kalender/caldav");
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
      assert.match(r.kalender, /im Kalender „Arbeit“/);
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
      assert.match(data.kalender, /nicht im Kalender: NOVA darf den Kalender noch nicht steuern/);
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
    ["CalDAV: Eintrag als iCalendar (UTC, Erinnerung, maskiert, umbrochen), Kalender nach Name, Ändern behält die UID", async () => {
      const e = { titel: "Rückruf Weber; Müller, Co", beginn: new Date(2026, 9, 8, 10, 0), dauerMinuten: 30, notiz: "Zeile 1\nTel. 07231 12345 " + "x".repeat(80), erinnerungMinuten: 15 };
      const text = ics("abc@nova", e, new Date(Date.UTC(2026, 9, 2, 1, 0)));
      assert.match(text, /^BEGIN:VCALENDAR\r\n/);
      assert.match(text, /\r\nDTSTART:20261008T080000Z\r\n/, "10 Uhr Sommerzeit = 08:00 UTC");
      assert.match(text, /\r\nDTEND:20261008T083000Z\r\n/);
      assert.match(text, /\r\nSUMMARY:Rückruf Weber\\; Müller\\, Co\r\n/);
      assert.match(text, /\r\nTRIGGER:-PT15M\r\n/);
      assert.ok(text.split("\r\n").every((z) => Buffer.byteLength(z, "utf8") <= 75), "Zeilen höchstens 75 Bytes");
      assert.match(text.replace(/\r\n /g, ""), /DESCRIPTION:Zeile 1\\nTel\. 07231 12345 x{80}/);

      const home = process.env.NOVA_HOME!;
      const aufrufe: string[] = [];
      let geschrieben = "";
      const cal = baueCaldavKalender(async () => ({
        async fetchCalendars() { return [{ url: "https://dav.example/cal/privat/", displayName: "Privat" }, { url: "https://dav.example/cal/arbeit/", displayName: "Arbeit", components: ["VEVENT"] }]; },
        async createCalendarObject(p) { aufrufe.push(`neu ${p.calendar.url}${p.filename}`); geschrieben = p.iCalString; return new Response(null, { status: 201 }); },
        async updateCalendarObject(p) { aufrufe.push(`ändern ${p.calendarObject.url}`); geschrieben = p.calendarObject.data; return new Response(null, { status: 204 }); },
        async deleteCalendarObject(p) { aufrufe.push(`weg ${p.calendarObject.url}`); return new Response(null, { status: 404 }); },
      }));
      assert.match((await cal.eintragen(e) as { grund: string }).grund, /Kein Kalender eingerichtet/);
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(path.join(home, "kalender.json"), JSON.stringify({ server: "https://dav.example", benutzer: "j@example.com", kalender: "Arbeit" }));
      assert.match((await cal.eintragen(e) as { grund: string }).grund, /fehlt das Passwort/);
      fs.mkdirSync(path.join(home, "geheim"), { recursive: true });
      fs.writeFileSync(path.join(home, "geheim", "kalender"), "app-pw");
      const r = await cal.eintragen(e);
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.equal(r.kalender, "Arbeit");
      assert.match(r.uid, /^https:\/\/dav\.example\/cal\/arbeit\/.+%40nova\.ics$/);
      const uid = geschrieben.match(/UID:(.+)\r\n/)![1];
      const r2 = await cal.aendern(r, { ...e, beginn: new Date(2026, 9, 9, 11, 0) });
      assert.equal(r2.ok, true);
      assert.equal(geschrieben.match(/UID:(.+)\r\n/)![1], uid, "gleiche UID beim Ändern");
      assert.match(geschrieben, /DTSTART:20261009T090000Z/);
      assert.equal((await cal.entfernen(r)).ok, true, "schon weg (404) gilt als entfernt");
      assert.deepEqual(aufrufe.map((a) => a.split(" ")[0]), ["neu", "ändern", "weg"]);
      fs.rmSync(path.join(home, "kalender.json"));
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
