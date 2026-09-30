import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

/**
 * Claude Code ohne Fenster: `claude -p <auftrag> --output-format json` im Projektordner.
 * Dateien darf Claude ändern (acceptEdits); Befehle nur aus der Erlaubtliste. Veröffentlichen und Pushen auf den
 * Hauptzweig sind gesperrt – das macht NOVA erst nach Joachims Freigabe selbst.
 */

export type ClaudeErgebnis = { ok: boolean; text: string; kostenUsd: number | null; sessionId: string | null };
export type ClaudeRunner = (input: { ordner: string; auftrag: string; hauptzweig: string }) => Promise<ClaudeErgebnis>;

export function claudeBin(): string {
  return process.env.NOVA_CLAUDE_BIN?.trim() || path.join(os.homedir(), ".local", "bin", "claude");
}

const ERLAUBT = [
  "Read", "Edit", "Write", "Glob", "Grep",
  "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)", "Bash(git add*)", "Bash(git commit*)", "Bash(git show*)",
  "Bash(git push -u origin nova/*)", "Bash(git push origin nova/*)",
  "Bash(npm run check*)", "Bash(npm run build*)", "Bash(npm test*)", "Bash(npm run test*)", "Bash(npx tsc*)", "Bash(ls*)", "Bash(cat*)",
];

export const echterClaude: ClaudeRunner = ({ ordner, auftrag, hauptzweig }) =>
  new Promise((resolve) => {
    const args = [
      "-p", auftrag,
      "--output-format", "json",
      "--permission-mode", "acceptEdits",
      "--allowedTools", ...ERLAUBT,
      "--disallowedTools", "Bash(*deploy*)", `Bash(git push origin ${hauptzweig}*)`, "Bash(git push --force*)", "Bash(ssh *)", "Bash(rsync *)", "Bash(rm -rf*)",
    ];
    const child = spawn(claudeBin(), args, { cwd: ordner, env: { ...process.env, DATABASE_URL: undefined }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 40 * 60_000);
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (err = (err + chunk.toString("utf8")).slice(-4000)));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, text: `Claude Code ließ sich nicht starten: ${error.message}`, kostenUsd: null, sessionId: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const json = JSON.parse(out) as { result?: string; is_error?: boolean; total_cost_usd?: number; session_id?: string };
        resolve({ ok: code === 0 && !json.is_error, text: json.result ?? "", kostenUsd: json.total_cost_usd ?? null, sessionId: json.session_id ?? null });
      } catch {
        resolve({ ok: false, text: `Claude Code beendet mit Code ${code}: ${(err || out).trim().slice(-600)}`, kostenUsd: null, sessionId: null });
      }
    });
  });
