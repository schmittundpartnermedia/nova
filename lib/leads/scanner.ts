import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Aufruf des Lead-Scanners (eigenes Projekt, Kommandozeile im Projektordner):
 * - Einzelsuche: `npx tsx src/index.ts --branche <b> --ort <o> --limit <n>` → „CSV geschrieben: <pfad>“
 * - Tageslauf:   `npx tsx src/daily.ts` (nie zuvor gezogene Betriebe aus seiner Orte×Branchen-Liste) → „N Leads geschrieben: <pfad>“
 * Er sucht über Google Places lokale Betriebe, liest das Impressum (E-Mail, Ansprechpartner) und schreibt eine CSV.
 * Siehe docs/SCRAPER.md.
 */

export type ScannerAuftrag = { branche: string; ort: string; anzahl: number };
export type ScannerLauf = { csvPfad: string; ausgabe: string };
export type ScannerRunner = (auftrag: ScannerAuftrag) => Promise<ScannerLauf>;
export type TageslaufRunner = () => Promise<ScannerLauf>;

export function scannerDir(): string {
  return process.env.NOVA_LEAD_SCANNER_DIR?.trim() || "/Volumes/ELEVUM/Projekte/joachim/lead-scanner";
}

/** Google Places liefert max. 20 Treffer pro Anfrage; der Scanner rechnet laut README ~0,035 $ pro Anfrage. */
export function geschaetzteKostenUsd(anzahl: number): number {
  return Math.ceil(Math.max(1, anzahl) / 20) * 0.035;
}

function fuehreAus(args: string[], csvMuster: RegExp, timeoutMs: number): Promise<ScannerLauf> {
  return new Promise((resolve, reject) => {
    const dir = scannerDir();
    if (!fs.existsSync(path.join(dir, args[0]!))) {
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
      const pfad = ausgabe.match(csvMuster)?.[1]?.trim();
      if (code !== 0 || !pfad) {
        reject(new Error(`Lead-Scanner beendet mit Code ${code}: ${ausgabe.trim().split("\n").slice(-3).join(" ")}`));
        return;
      }
      resolve({ csvPfad: pfad, ausgabe });
    });
  });
}

/** extraArgs nur für Nachweise, z. B. `--fixture fixtures/places_sample.json --skip-audit` (keine API-Kosten). */
export function baueScanner(extraArgs: string[] = []): ScannerRunner {
  return (auftrag) =>
    fuehreAus(
      ["src/index.ts", "--branche", auftrag.branche, "--ort", auftrag.ort, "--limit", String(auftrag.anzahl), ...extraArgs],
      /CSV geschrieben:\s*(.+\.csv)/,
      15 * 60_000,
    );
}

export const echterScanner: ScannerRunner = baueScanner();

export const echterTageslauf: TageslaufRunner = () =>
  fuehreAus(["src/daily.ts"], /\d+ Leads geschrieben:\s*(.+\.csv)/, 30 * 60_000);
