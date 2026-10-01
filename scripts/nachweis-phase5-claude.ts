/**
 * Nachweis Phase 5 mit dem ECHTEN Claude Code – an einem Wegwerf-Projekt (nicht rankpilot.de):
 * Auftrag „Telefonnummer im Footer ändern“ → claude -p im Projektordner → NOVA prüft → Freigabe → übernehmen,
 * pushen (in ein lokales bare Repo), „Live“-Skript (schreibt nur eine Markierung). Ausgabe: docs/nachweis-phase5-claude.txt
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wegwerfDatenbank } from "./lib/wegwerf-db";

// Deutsche Zeit wie auf dem Server (pm2: TZ=Europe/Berlin), unabhängig vom Rechner, auf dem der Test läuft.
process.env.TZ = "Europe/Berlin";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-nachweis-p5-"));
process.env.NOVA_HOME = path.join(tmp, "home");
const lines: string[] = [];
const log = (line = "") => {
  lines.push(line);
  console.log(line);
};
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
  log(`  ✓ ${message}`);
};

async function main() {
  wegwerfDatenbank();
  const origin = path.join(tmp, "origin.git");
  const repo = path.join(tmp, "testseite");
  const marker = path.join(tmp, "live.txt");
  execSync(`git init --bare -b main ${origin} && git clone ${origin} ${repo}`, { cwd: tmp, stdio: "ignore" });
  execSync('git config user.email "nachweis@nova" && git config user.name "Nachweis"', { cwd: repo });
  fs.writeFileSync(path.join(repo, "index.html"), '<html><body>\n<main>Willkommen</main>\n<footer>Telefon: 0711 111 111</footer>\n</body></html>\n');
  execSync("git add -A && git commit -m start && git push -u origin main", { cwd: repo, stdio: "ignore" });
  fs.mkdirSync(path.join(process.env.NOVA_HOME!, "claude"), { recursive: true });
  fs.writeFileSync(
    path.join(process.env.NOVA_HOME!, "claude", "projekte.json"),
    JSON.stringify([{ name: "webseite", beschreibung: "Nachweis-Testseite", ordner: repo, hauptzweig: "main", pruefen: ["grep -q '0711 222 333' index.html"], live: `echo live > ${marker} && echo Deploy fertig` }]),
  );

  const { prisma } = await import("@/lib/prisma");
  const { beauftrageClaude, fuehreAuftragAus, claudeLiveStellen, fuehreLiveAus } = await import("@/services/claude");
  const { echterClaude } = await import("@/lib/claude/runner");
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  const org = await prisma.organization.create({ data: { name: "Nachweis", slug: `n-${Date.now()}` } });

  log(`NOVA Phase-5-Nachweis (echtes Claude Code, Wegwerf-Projekt) – ${new Date().toISOString()}`);
  const auftrag = await beauftrageClaude({ organizationId: org.id, projekt: "webseite", aufgabe: "Ändere im Footer der Seite index.html die Telefonnummer auf 0711 222 333.", abnahmekriterium: "Im Footer steht 0711 222 333." });
  log(`Auftrag ${auftrag.id} angelegt.`);
  const start = Date.now();
  const fertig = await fuehreAuftragAus({ auftragId: auftrag.id, claude: echterClaude });
  log(`Claude Code lief ${Math.round((Date.now() - start) / 1000)} s. Status: ${fertig.status}. Kosten: ${fertig.kostenUsd ?? "?"} $`);
  log(`Claude: ${fertig.zusammenfassung}`);
  log(`Commits: ${JSON.stringify(fertig.commits)} · Dateien: ${JSON.stringify(fertig.dateien)} · Prüfung: ${JSON.stringify(fertig.pruefung?.map((p) => [p.befehl, p.ok]))}`);
  check(fertig.status === "fertig", "Auftrag fertig und von NOVA geprüft");
  check(execSync("git branch --show-current", { cwd: repo, encoding: "utf8" }).trim() === "main", "Projekt steht wieder auf main");
  check(fs.readFileSync(path.join(repo, "index.html"), "utf8").includes("0711 111 111"), "main unverändert vor der Freigabe");
  check(execSync(`git --git-dir=${origin} branch --list 'nova/*'`, { encoding: "utf8" }).includes(auftrag.branch), "Claude hat den Branch gepusht");
  check(!fs.existsSync(marker), "nichts veröffentlicht");
  log(`Meldung: ${(await holeNeueMeldungen(org.id)).at(-1)?.text}`);

  const frage = await claudeLiveStellen({ organizationId: org.id, auftragId: auftrag.id });
  check(frage.status === "freigabe_noetig", "Live nur mit Freigabe");
  await claudeLiveStellen({ organizationId: org.id, auftragId: auftrag.id, freigabeId: (frage as { freigabe_id: string }).freigabe_id });
  const live = await fuehreLiveAus({ auftragId: auftrag.id });
  check(live.status === "live", "übernommen, gepusht, veröffentlicht");
  check(execSync(`git --git-dir=${origin} show main:index.html`, { encoding: "utf8" }).includes("0711 222 333"), "Änderung im Hauptzweig auf dem Server-Repo");
  log(`Meldung: ${(await holeNeueMeldungen(org.id)).at(-1)?.text}`);
  log();
  log("ERGEBNIS: Phase-5-Nachweis bestanden (echtes Claude Code, Wegwerf-Projekt, Deploy nur als Markierung).");
  log("Nicht geprüft: echtes rankpilot.de-Projekt, echtes deploy-rpw – das prüft Joachim in NOVA.app.");
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    log(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(path.join(process.cwd(), "docs", "nachweis-phase5-claude.txt"), `${lines.join("\n")}\n`, "utf8");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
