import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Aufruf des Lead-Scanners (eigenes Projekt, Kommandozeile im Projektordner), Gebietssuche:
 *   `npx tsx src/gebiet.ts --branche <b> --mitte <ort> --radius <km> --max-anfragen <n>` → „CSV geschrieben: <pfad>“
 * Sucht ALLE Betriebe der Branche im Umkreis (Kacheln mit fester Gebietsgrenze bei Google Places, volle Kacheln
 * werden geteilt), prüft jede Website (E-Mail, Ansprechpartner, Befunde) und schreibt eine CSV.
 * Siehe docs/SCRAPER.md.
 */

export type GebietsAuftrag = { branche: string; mitte: string; radiusKm: number };
export type ScannerLauf = { csvPfad: string; ausgabe: string };
export type GebietsRunner = (auftrag: GebietsAuftrag & { maxAnfragen: number }) => Promise<ScannerLauf>;

export function scannerDir(): string {
  return process.env.NOVA_LEAD_SCANNER_DIR?.trim() || "/Volumes/ELEVUM/Projekte/joachim/lead-scanner";
}

/** Preis je Google-Anfrage laut Scanner-README (Text Search, Enterprise-SKU). */
const USD_PRO_ANFRAGE = 0.035;
const KANTE_KM = 8;

/**
 * Kosten der Gebietssuche: so viele Startkacheln wie im Scanner (8 km), je ~1,3 Anfragen (Seiten, geteilte Kacheln).
 * Obergrenze = viermal die Kachelzahl; mehr Anfragen stellt der Scanner nie (er meldet dann „unvollständig“).
 */
export function schaetzeKosten(radiusKm: number): { anfragen: number; kostenUsd: number; maxAnfragen: number; maxKostenUsd: number } {
  const n = Math.ceil(radiusKm / KANTE_KM);
  let kacheln = 0;
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      const x = Math.max(i * KANTE_KM, Math.min(0, (i + 1) * KANTE_KM));
      const y = Math.max(j * KANTE_KM, Math.min(0, (j + 1) * KANTE_KM));
      if (Math.hypot(x, y) <= radiusKm) kacheln++;
    }
  }
  const anfragen = Math.ceil(kacheln * 1.3) + 1;
  const maxAnfragen = Math.max(20, kacheln * 4);
  return {
    anfragen,
    kostenUsd: Math.round(anfragen * USD_PRO_ANFRAGE * 100) / 100,
    maxAnfragen,
    maxKostenUsd: Math.round(maxAnfragen * USD_PRO_ANFRAGE * 100) / 100,
  };
}

function fuehreAus(args: string[], timeoutMs: number): Promise<ScannerLauf> {
  return new Promise((resolve, reject) => {
    const dir = scannerDir();
    if (!fs.existsSync(path.join(/*turbopackIgnore: true*/ dir, args[0]!))) {
      reject(new Error(`Lead-Scanner nicht gefunden unter ${dir}.`));
      return;
    }
    const child = spawn("npx", ["tsx", ...args], {
      cwd: dir,
      env: { ...process.env, DATABASE_URL: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ausgabe = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const sammle = (chunk: Buffer) => {
      ausgabe = (ausgabe + chunk.toString("utf8")).slice(-50_000);
    };
    child.stdout.on("data", sammle);
    child.stderr.on("data", sammle);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const pfad = ausgabe.match(/CSV geschrieben:\s*(.+\.csv)/)?.[1]?.trim();
      if (code !== 0 || !pfad) {
        reject(new Error(`Lead-Scanner beendet mit Code ${code}: ${ausgabe.trim().split("\n").slice(-3).join(" ")}`));
        return;
      }
      resolve({ csvPfad: pfad, ausgabe });
    });
  });
}

/** extraArgs nur für Nachweise, z. B. `--fixture fixtures/places_sample.json --lage 48.89,8.69 --skip-audit` (keine API-Kosten). */
export function baueGebietsScanner(extraArgs: string[] = []): GebietsRunner {
  return (auftrag) =>
    fuehreAus(
      [
        "src/gebiet.ts",
        "--branche", auftrag.branche,
        "--mitte", auftrag.mitte,
        "--radius", String(auftrag.radiusKm),
        "--max-anfragen", String(auftrag.maxAnfragen),
        ...extraArgs,
      ],
      120 * 60_000,
    );
}

export const echterGebietsScanner: GebietsRunner = baueGebietsScanner();
