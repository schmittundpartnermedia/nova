import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Aufruf des Lead-Scanners (eigenes Projekt, Kommandozeile):
 *   npx tsx src/index.ts --branche <b> --ort <o> --limit <n>   (im Projektordner)
 * Er sucht über Google Places lokale Betriebe, liest Impressum (E-Mail, Ansprechpartner) und schreibt eine CSV.
 * Siehe docs/SCRAPER.md.
 */

export type ScannerAuftrag = { branche: string; ort: string; anzahl: number };
export type ScannerLauf = { csvPfad: string; ausgabe: string };
export type ScannerRunner = (auftrag: ScannerAuftrag) => Promise<ScannerLauf>;

export function scannerDir(): string {
  return (
    process.env.NOVA_LEAD_SCANNER_DIR?.trim() ||
    "/Volumes/ELEVUM/Projekte/joachim/lead-scanner"
  );
}

/** Google Places liefert max. 20 Treffer pro Anfrage; der Scanner rechnet laut README ~0,035 $ pro Anfrage. */
export function geschaetzteKostenUsd(anzahl: number): number {
  return Math.ceil(Math.max(1, anzahl) / 20) * 0.035;
}

/** extraArgs nur für Nachweise, z. B. `--fixture fixtures/places_sample.json --skip-audit` (keine API-Kosten). */
export function baueScanner(extraArgs: string[] = []): ScannerRunner {
  return (auftrag) =>
    new Promise((resolve, reject) => {
      const dir = scannerDir();
      if (!fs.existsSync(path.join(dir, "src", "index.ts"))) {
        reject(new Error(`Lead-Scanner nicht gefunden unter ${dir}.`));
        return;
      }
      const args = [
        "tsx",
        "src/index.ts",
        "--branche",
        auftrag.branche,
        "--ort",
        auftrag.ort,
        "--limit",
        String(auftrag.anzahl),
        ...extraArgs,
      ];
      const child = spawn("npx", args, {
        cwd: dir,
        env: { ...process.env, DATABASE_URL: undefined },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let ausgabe = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60_000);
      child.stdout.on("data", (chunk: Buffer) => {
        ausgabe = (ausgabe + chunk.toString("utf8")).slice(-50_000);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        ausgabe = (ausgabe + chunk.toString("utf8")).slice(-50_000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const pfad = ausgabe.match(/CSV geschrieben:\s*(.+\.csv)/)?.[1]?.trim();
        if (code !== 0 || !pfad) {
          reject(
            new Error(
              `Lead-Scanner beendet mit Code ${code}: ${ausgabe.trim().split("\n").slice(-3).join(" ")}`,
            ),
          );
          return;
        }
        resolve({ csvPfad: pfad, ausgabe });
      });
    });
}

export const echterScanner: ScannerRunner = baueScanner();
