/**
 * Nachweis Phase 4: echte Gebietssuche des Lead-Scanners (Kommandozeile, src/gebiet.ts) mit seiner eigenen
 * Beispieldatei – ohne Google-API, ohne Website-Abruf. Prüft Aufruf, CSV-Erkennung und Einlesen in NOVA
 * (Vorrat, Firmen, Liste; Wegwerf-DB und -NOVA_HOME).
 * Die vom Scanner erzeugte CSV unter lead-scanner/output wird danach wieder gelöscht.
 * Ausgabe: docs/nachweis-phase4-scanner.txt
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-nachweis-p4-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "nachweis.db")}`;
process.env.NOVA_HOME = path.join(tmp, "home");
const lines: string[] = [];
const log = (line = "") => {
  lines.push(line);
  console.log(line);
};
let scannerCsv = "";

async function main() {
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { env: process.env, encoding: "utf8" });
  if (push.status !== 0) throw new Error(push.stderr);
  const { prisma } = await import("@/lib/prisma");
  const { baueGebietsScanner, scannerDir } = await import("@/lib/leads/scanner");
  const { fuehreGebietssucheAus } = await import("@/services/leads");
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  const { leseKontaktliste } = await import("@/lib/mail/kontaktlisten");
  const org = await prisma.organization.create({ data: { name: "Nachweis", slug: `nachweis-${Date.now()}` } });

  log(`NOVA Phase-4-Nachweis Lead-Scanner – ${new Date().toISOString()}`);
  log(`Scanner: ${scannerDir()} – Gebietssuche mit Beispieldatei fixtures/places_sample.json, --skip-audit, keine API-Kosten`);
  const runner = baueGebietsScanner(["--fixture", "fixtures/places_sample.json", "--lage", "48.8922,8.6946", "--skip-audit"]);
  const gemerkt = async (auftrag: Parameters<typeof runner>[0]) => {
    const lauf = await runner(auftrag);
    scannerCsv = lauf.csvPfad;
    log(`Scanner-CSV: ${lauf.csvPfad}`);
    return lauf;
  };
  const result = await fuehreGebietssucheAus({
    organizationId: org.id,
    auftrag: { branche: "Nachweis Schreinerei", mitte: "Pforzheim", radiusKm: 40 },
    runner: gemerkt,
    mx: async () => true,
  });
  if (!result.ok) throw new Error(result.grund);
  log(`Liste: ${result.liste} – ${result.gefunden} Betriebe, ${result.mitEmail} mit E-Mail, ${result.neuImVorrat} neu im Vorrat`);
  for (const zeile of leseKontaktliste(result.liste)) {
    log(`  ${zeile.werte.firma} | ${zeile.werte.anrede} | ${zeile.werte.email || "(keine E-Mail)"} | ${zeile.werte.telefon}`);
  }
  log(`Firmen in DB: ${await prisma.company.count()}, Kontakte: ${await prisma.contact.count()}, Vorrat (leads): ${await prisma.lead.count()}`);
  const meldung = await holeNeueMeldungen(org.id);
  log(`Meldung: ${meldung[0]?.text ?? "(keine)"}`);
  if (result.gefunden < 1 || meldung.length !== 1 || (await prisma.lead.count()) !== result.gefunden) throw new Error("Einlesen oder Meldung fehlt.");
  log("");
  log("ERGEBNIS: Aufruf der echten Gebietssuche des Lead-Scanners und Einlesen in NOVA funktionieren (Beispieldaten, ohne Google-API).");
  log("Nicht geprüft: echte Google-Abfrage mit Kacheln und Impressum-Auslese – braucht Joachims Freigabe (kostet Google-Anfragen).");
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    log(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (scannerCsv && fs.existsSync(scannerCsv)) fs.rmSync(scannerCsv);
    fs.writeFileSync(path.join(process.cwd(), "docs", "nachweis-phase4-scanner.txt"), `${lines.join("\n")}\n`, "utf8");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
