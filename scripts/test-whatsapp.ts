/**
 * Regressionstest WhatsApp über Zernio – ohne Netz, ohne Zernio, ohne App.
 * Wegwerf-Datenbank und -NOVA_HOME, Zernio im Speicher, geskriptetes Modell für die Wache.
 * Geprüft wird: Vornamen, Vorlage muss bei Meta freigegeben sein, planen sendet nichts, starten nur mit eigener Freigabe,
 * Wellen (pro Tag, 9–19 Uhr), Versand nur bei laufender Kampagne, „opted out“ sperrt, Abbruch, Wache (Stop, schon
 * beantwortet, Vorschlag), Antwort nur mit Freigabe und im 24-Stunden-Fenster.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TZ = "Europe/Berlin";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-whatsapp-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.NOVA_HOME = path.join(tmp, "home");

type HeadProvider = import("@/types/ai").HeadProvider;
type HeadTurnInput = import("@/types/ai").HeadTurnInput;
type WhatsappDienst = import("@/lib/whatsapp/zernio").WhatsappDienst;
type ZernioNachricht = import("@/lib/whatsapp/zernio").ZernioNachricht;

const ergebnisse: Array<{ name: string; ok: boolean; fehler?: string }> = [];
async function fall(name: string, f: () => Promise<void>) {
  try {
    await f();
    ergebnisse.push({ name, ok: true });
  } catch (e) {
    ergebnisse.push({ name, ok: false, fehler: e instanceof Error ? e.stack ?? e.message : String(e) });
  }
}

async function main() {
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { env: process.env, encoding: "utf8" });
  if (push.status !== 0) throw new Error(push.stderr);
  const home = process.env.NOVA_HOME!;
  fs.mkdirSync(path.join(home, "vorlagen", "whatsapp"), { recursive: true });
  fs.writeFileSync(
    path.join(home, "vorlagen", "whatsapp", "hallo.md"),
    "---\nname: kunden_hallo\nkategorie: MARKETING\nsprache: de\n---\nHallo {{Vorname}}, lange nichts gehört! Ich habe *rankPilot* aufgebaut.\nLiebe Grüße\nJoachim\n",
  );

  const { prisma } = await import("@/lib/prisma");
  const { executeTool } = await import("@/services/tools/registry");
  const { setzeWhatsappDienst, ZernioFehler } = await import("@/lib/whatsapp/zernio");
  const w = await import("@/services/whatsapp");
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });

  // Zernio im Speicher
  let metaStatus = "PENDING";
  const eingereicht: Array<{ name: string; text: string; beispiel: string[] }> = [];
  const vorlagenGesendet: Array<{ telefon: string; werte: string[] }> = [];
  const texteGesendet: Array<{ gespraechId: string; text: string }> = [];
  const gesperrtBeiMeta = new Set<string>(["4917000000004"]);
  const verlaeufe = new Map<string, ZernioNachricht[]>();
  const dienst: WhatsappDienst = {
    async konto() {
      return { id: "acc1", name: "Joachim", nummer: "+49 151 0000000" };
    },
    async vorlagen() {
      return [{ name: "kunden_hallo", sprache: "de", status: metaStatus, kategorie: "MARKETING", text: null, ablehnungsgrund: null }];
    },
    async vorlageEinreichen(input) {
      eingereicht.push({ name: input.name, text: input.text, beispiel: input.beispiel });
      return { status: "PENDING" };
    },
    async kontakte() {
      return [
        { id: "z1", name: "Anna Schmidt", telefon: "4917000000001" },
        { id: "z2", name: "Bäckerei Müller", telefon: "4917000000002" },
        { id: "z3", name: "Tom", telefon: "4917000000003" },
        { id: "z4", name: "Petra Lang", telefon: "4917000000004" },
        { id: "z5", name: "Klaus-Dieter Weber", telefon: "4917000000005" },
      ];
    },
    async sendeVorlage(input) {
      if (gesperrtBeiMeta.has(input.telefon)) throw new ZernioFehler("Zernio 409 recipient_opted_out: opted out", 409, "recipient_opted_out");
      vorlagenGesendet.push({ telefon: input.telefon, werte: input.werte });
      const gid = `g-${input.telefon}`;
      verlaeufe.set(gid, [{ id: `m-aus-${input.telefon}`, richtung: "aus", text: "Hallo …", zeit: new Date().toISOString(), status: "sent", perApp: false }]);
      return { nachrichtId: `m-aus-${input.telefon}`, gespraechId: gid };
    },
    async gespraeche() {
      return [...verlaeufe.entries()].map(([id, v]) => ({ id, telefon: id.slice(2), name: null, aktualisiert: v[v.length - 1]!.zeit, ungelesen: 1 }));
    },
    async nachrichten(gid) {
      return [...(verlaeufe.get(gid) ?? [])].reverse();
    },
    async sendeText(input) {
      texteGesendet.push(input);
      return { nachrichtId: `t-${texteGesendet.length}` };
    },
  };
  setzeWhatsappDienst(dienst);

  await fall("Vornamen: sicher, unsicher, Firma", async () => {
    assert.deepEqual(w.vornameAus("Anna Schmidt"), { vorname: "Anna", unsicher: false });
    assert.deepEqual(w.vornameAus("Klaus-Dieter Weber"), { vorname: "Klaus-Dieter", unsicher: false });
    assert.equal(w.vornameAus("Tom").unsicher, true);
    assert.equal(w.vornameAus("Bäckerei Müller").vorname, null);
    assert.equal(w.vornameAus("Dr. Hans Meier").vorname, null);
    assert.equal(w.vornameAus("🍀 Lisa Berg").vorname, "Lisa");
  });

  await fall("Kontakte holen, Joachims Vorname bleibt", async () => {
    const r = await executeTool("whatsapp_kontakte_holen", {}, { organizationId: org.id, postfach: null as never });
    assert.ok(r.ok, r.error);
    const d = r.data as { gesamt: number; mit_sicherem_vornamen: number; ohne_vornamen: number; vorname_unsicher: number };
    assert.deepEqual([d.gesamt, d.mit_sicherem_vornamen, d.ohne_vornamen, d.vorname_unsicher], [5, 3, 1, 1]);
    await w.aendereKontakt(org.id, "+49 170 00000003", { vorname: "Thomas" });
    await w.holeKontakte(org.id);
    const tom = await prisma.whatsappKontakt.findFirstOrThrow({ where: { telefon: "4917000000003" } });
    assert.equal(tom.vorname, "Thomas");
    assert.equal(tom.vornameUnsicher, false);
  });

  await fall("Vorlage einreichen: {{Vorname}} wird {{1}}", async () => {
    const r = await executeTool("whatsapp_vorlage_einreichen", { name: "kunden_hallo" }, { organizationId: org.id, postfach: null as never });
    assert.ok(r.ok && r.executed, r.error);
    assert.match(eingereicht[0]!.text, /^Hallo \{\{1\}\}, /);
    assert.deepEqual(eingereicht[0]!.beispiel, ["Anna"]);
  });

  let kampagneId = "";
  let freigabeId = "";
  await fall("Planen: nur mit Meta-Freigabe, sendet nichts", async () => {
    const vorher = await executeTool(
      "whatsapp_kampagne_planen",
      { vorlage: "kunden_hallo", anzahl: 10, pro_tag: 2, abstand_sekunden: 60, auch_unsichere: false },
      { organizationId: org.id, postfach: null as never },
    );
    assert.equal(vorher.ok, false);
    assert.match(String(vorher.error), /noch nicht freigegeben/);
    metaStatus = "APPROVED";
    const r = await executeTool(
      "whatsapp_kampagne_planen",
      { vorlage: "kunden_hallo", anzahl: 10, pro_tag: 2, abstand_sekunden: 60, auch_unsichere: false },
      { organizationId: org.id, postfach: null as never },
    );
    assert.ok(r.ok, r.error);
    const d = r.data as { kampagne_id: string; freigabe_id: string; anzahl: number; tage: number; kosten_bis_usd: number; beispiel: string; nicht_dabei: { ohne_vornamen: number } };
    // Anna, Thomas (von Joachim gesetzt), Petra, Klaus-Dieter – ohne Bäckerei.
    assert.equal(d.anzahl, 4);
    assert.equal(d.tage, 2);
    assert.equal(d.kosten_bis_usd, 0.55);
    assert.equal(d.nicht_dabei.ohne_vornamen, 1);
    assert.match(d.beispiel, /^Hallo Anna, /);
    assert.equal(vorlagenGesendet.length, 0);
    assert.equal(await prisma.workItem.count({ where: { kind: "whatsapp.send" } }), 0);
    kampagneId = d.kampagne_id;
    freigabeId = d.freigabe_id;
  });

  await fall("Starten nur mit eigener Freigabe; Wellen 2 pro Tag, 9 bis 19 Uhr", async () => {
    const falsch = await executeTool("whatsapp_kampagne_starten", { kampagne_id: kampagneId, freigabe_id: "fremd" }, { organizationId: org.id, postfach: null as never });
    assert.equal(falsch.ok, false);
    await w.starteWhatsappKampagne({ organizationId: org.id, kampagneId, freigabeId, jetzt: new Date("2026-10-05T18:59:30+02:00") });
    const items = await prisma.workItem.findMany({ where: { kind: "whatsapp.send" }, orderBy: { runAt: "asc" } });
    const zeiten = items.map((i) => i.runAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }));
    assert.deepEqual(zeiten, ["5.10.2026, 18:59:30", "6.10.2026, 09:00:00", "6.10.2026, 09:01:00", "7.10.2026, 09:00:00"]);
    assert.equal(await prisma.workItem.count({ where: { kind: "whatsapp.wache" } }), 1);
  });

  await fall("Versand: Vorname als Wert, „opted out“ sperrt", async () => {
    const geplant = await prisma.whatsappNachricht.findMany({ where: { kampagneId, status: "geplant" }, orderBy: { geplantFuer: "asc" } });
    for (const n of geplant) await w.sendeKampagnenNachricht(org.id, n.id);
    assert.deepEqual(vorlagenGesendet.map((v) => v.werte[0]).sort(), ["Anna", "Klaus-Dieter", "Thomas"]);
    const petra = await prisma.whatsappKontakt.findFirstOrThrow({ where: { telefon: "4917000000004" } });
    assert.equal(petra.gesperrt, true);
    const stand = await w.whatsappKampagnenStand(org.id, kampagneId);
    assert.equal(stand.status, "fertig");
    assert.equal(stand.gesendet, 3);
    assert.equal(stand.fehlgeschlagen.length, 1);
    const meldungen = await holeNeueMeldungen(org.id);
    assert.ok(meldungen.some((m) => /ist durch: 3 von 4/.test(m.text)));
    // Zweiter Aufruf derselben Nachricht sendet nicht doppelt.
    await w.sendeKampagnenNachricht(org.id, geplant[0]!.id);
    assert.equal(vorlagenGesendet.length, 3);
  });

  await fall("Ohne laufende Kampagne geht nichts raus; Abbruch stoppt den Rest", async () => {
    await prisma.whatsappKontakt.create({ data: { organizationId: org.id, telefon: "4917000000006", name: "Eva Sommer", vorname: "Eva" } });
    await prisma.whatsappKontakt.create({ data: { organizationId: org.id, telefon: "4917000000007", name: "Jan Winter", vorname: "Jan" } });
    const plan = await w.planeWhatsappKampagne({ organizationId: org.id, vorlage: "kunden_hallo", anzahl: 5, proTag: 50, abstandSekunden: 60 });
    assert.equal(plan.anzahl, 2);
    const n = await prisma.whatsappNachricht.findFirstOrThrow({ where: { kampagneId: plan.kampagne_id } });
    await prisma.whatsappNachricht.update({ where: { id: n.id }, data: { status: "geplant" } });
    await w.sendeKampagnenNachricht(org.id, n.id);
    assert.equal(vorlagenGesendet.length, 3);
    assert.equal((await prisma.whatsappNachricht.findUniqueOrThrow({ where: { id: n.id } })).status, "abgebrochen");
    const ab = await w.brecheWhatsappKampagneAb(org.id, plan.kampagne_id);
    assert.equal(ab.status, "abgebrochen");
    assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: plan.freigabe_id } })).status, "rejected");
  });

  const kopfAufrufe: HeadTurnInput[] = [];
  const kopf: HeadProvider = {
    id: "skript",
    async headTurn(input) {
      kopfAufrufe.push(input);
      if (kopfAufrufe.length === 1) {
        return { responseId: "r1", text: "", model: "m", provider: "skript", toolCalls: [{ callId: "c1", name: "whatsapp_antwort_entwurf", arguments: { telefon: "4917000000001", text: "Hey Anna, schön von dir zu hören! Lass uns telefonieren." } }] };
      }
      return { responseId: "r2", text: "Anna hat geantwortet und fragt nach rankPilot. Mein Vorschlag: ein kurzes Telefonat. Soll ich so senden?", toolCalls: [], model: "m", provider: "skript" };
    },
    async healthCheck() {
      return { ok: true, provider: "skript", message: "" };
    },
  };

  let entwurf = { id: "", freigabe: "" };
  await fall("Wache: Antwort → Vorschlag; Stop → gesperrt; schon beantwortet → nichts", async () => {
    // Antworten kommen nach dem Versand (Millisekunden später), Joachims eigene Antwort danach.
    const t0 = Date.now() + 5;
    const spaeter = (ms: number) => new Date(t0 + ms).toISOString();
    verlaeufe.get("g-4917000000001")!.push({ id: "e1", richtung: "ein", text: "Hey Joachim! Was ist rankPilot genau?", zeit: spaeter(0), status: null, perApp: false });
    verlaeufe.get("g-4917000000003")!.push({ id: "e2", richtung: "ein", text: "Stop bitte", zeit: spaeter(0), status: null, perApp: false });
    verlaeufe.get("g-4917000000005")!.push(
      { id: "e3", richtung: "ein", text: "Grüß dich!", zeit: spaeter(0), status: null, perApp: false },
      { id: "a3", richtung: "aus", text: "Hi Klaus!", zeit: spaeter(1), status: "sent", perApp: true },
    );
    const r = await w.whatsappWache({ organizationId: org.id, kopf: { provider: kopf, model: "m" }, postfach: null as never, jetzt: new Date(t0 + 60_000) });
    assert.equal(r.neu, 3);
    assert.equal(kopfAufrufe.length, 2);
    assert.match(String((kopfAufrufe[0]!.input[0] as { content: string }).content), /^\[WhatsApp-Wache\] Anna/);
    const tom = await prisma.whatsappKontakt.findFirstOrThrow({ where: { telefon: "4917000000003" } });
    assert.equal(tom.gesperrt, true);
    const meldungen = await holeNeueMeldungen(org.id);
    assert.ok(meldungen.some((m) => /möchte keine WhatsApp-Nachrichten mehr/.test(m.text)));
    assert.ok(meldungen.some((m) => /Anna hat geantwortet/.test(m.text)));
    assert.equal(texteGesendet.length, 0);
    // Zweiter Lauf: nichts Neues, kein weiterer Kopf-Aufruf.
    await w.whatsappWache({ organizationId: org.id, kopf: { provider: kopf, model: "m" }, postfach: null as never, jetzt: new Date(t0 + 120_000) });
    assert.equal(kopfAufrufe.length, 2);
    const e = await prisma.whatsappNachricht.findFirstOrThrow({ where: { telefon: "4917000000001", status: "entwurf" } });
    entwurf = { id: e.id, freigabe: e.approvalId! };
  });

  await fall("Antwort senden nur mit eigener Freigabe und im 24-Stunden-Fenster", async () => {
    const falsch = await executeTool("whatsapp_antwort_senden", { entwurf_id: entwurf.id, freigabe_id: "fremd" }, { organizationId: org.id, postfach: null as never });
    assert.equal(falsch.ok, false);
    await assert.rejects(() => w.sendeAntwort(org.id, entwurf.id, entwurf.freigabe, new Date(Date.now() + 25 * 3600_000)), /älter als 24 Stunden/);
    const r = await executeTool("whatsapp_antwort_senden", { entwurf_id: entwurf.id, freigabe_id: entwurf.freigabe }, { organizationId: org.id, postfach: null as never });
    assert.ok(r.ok, r.error);
    assert.deepEqual(texteGesendet, [{ gespraechId: "g-4917000000001", text: "Hey Anna, schön von dir zu hören! Lass uns telefonieren." }]);
    assert.equal((await w.offeneAntworten(org.id)).some((o) => o.telefon === "4917000000001"), false);
  });

  await fall("Gedankenstrich in Vorlage und Antwort abgelehnt", async () => {
    fs.writeFileSync(path.join(home, "vorlagen", "whatsapp", "kaputt.md"), "---\nname: kaputt\nkategorie: MARKETING\nsprache: de\n---\nHallo {{Vorname}} – na?\n");
    const r = await executeTool("whatsapp_vorlage_einreichen", { name: "kaputt" }, { organizationId: org.id, postfach: null as never });
    assert.equal(r.ok, false);
    fs.rmSync(path.join(home, "vorlagen", "whatsapp", "kaputt.md"));
    await assert.rejects(() => w.antwortEntwurf(org.id, "4917000000005", "Hi – du"), /Gedankenstrich/);
  });

  await prisma.$disconnect();
  setzeWhatsappDienst(null);
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const e of ergebnisse) console.log(`${e.ok ? "✓" : "✗"} ${e.name}${e.ok ? "" : `\n${e.fehler}`}`);
  const rot = ergebnisse.filter((e) => !e.ok).length;
  console.log(rot ? `${rot} von ${ergebnisse.length} fehlgeschlagen` : `alle ${ergebnisse.length} bestanden`);
  process.exit(rot ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
