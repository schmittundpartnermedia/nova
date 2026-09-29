/**
 * Nachweis Phase 1 (ohne Mikrofon/Bildschirm):
 * Dauergedächtnis + Kopf-Tool-Loop + Gesprächsverlauf.
 * Ausgabe: docs/nachweis-phase1-kopf.txt
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureGedaechtnis, ladeAlleGedaechtnisDateien, lesenGedaechtnis } from "@/lib/gedaechtnis/store";
import { gedaechtnisDir } from "@/lib/gedaechtnis/paths";
import { runHeadLoop } from "@/agents/master/head";
import { OpenAIProvider } from "@/providers/ai/openai";
import { hasOpenAIApiKey } from "@/lib/secrets";
import { HEAD_MODEL } from "@/providers/ai/models";
import type { Postfach } from "@/services/mail/postfach";

/** Der Phase-1-Nachweis braucht kein Postfach; ein Zugriff würde den Nachweis scheitern lassen. */
const keinPostfach: Postfach = {
  neueste: async () => { throw new Error("Nachweis Phase 1 nutzt kein Postfach."); },
  lesen: async () => { throw new Error("Nachweis Phase 1 nutzt kein Postfach."); },
  senden: async () => { throw new Error("Nachweis Phase 1 nutzt kein Postfach."); },
  antworten: async () => { throw new Error("Nachweis Phase 1 nutzt kein Postfach."); },
};
const context = { organizationId: "nachweis-phase1", postfach: keinPostfach };

function loadEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();

const lines: string[] = [];
function log(line: string) {
  lines.push(line);
  console.log(line);
}

async function main() {
  const stamp = new Date().toISOString();
  log(`NOVA Phase-1-Nachweis Kopf/Gedächtnis – ${stamp}`);
  log(`Host: ${os.hostname()}`);
  log(`NOVA_HOME override: ${process.env.NOVA_HOME ?? "(keine, nutzt ~/Nova)"}`);

  // Isolierter Ordner für den Nachweis, Nutzer-Gedächtnis bleibt unberührt.
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nova-phase1-"));
  process.env.NOVA_HOME = tmpHome;
  log(`Test-NOVA_HOME: ${tmpHome}`);

  ensureGedaechtnis();
  const dir = gedaechtnisDir();
  const files = fs.readdirSync(dir).sort();
  log(`Gedächtnis-Ordner: ${dir}`);
  log(`Dateien: ${files.join(", ")}`);
  if (!files.includes("firma.md") || !files.includes("kunden.md") || !files.includes("projekte.md")) {
    throw new Error("Gedächtnisdateien fehlen.");
  }

  if (!hasOpenAIApiKey()) {
    throw new Error("Kein OPENAI_API_KEY – echter Kopf-Nachweis nicht möglich.");
  }

  const provider = new OpenAIProvider();
  const model = HEAD_MODEL;
  log(`Modell: ${model}`);
  log(`Tool-Calling: Responses API (headTurn)`);

  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  const turn1 = await runHeadLoop({
    provider,
    model,
    history,
    context,
    userRequest:
      "Merk dir: unsere Firma ist rankpilot, wir machen Lokal-SEO, wir suchen Sponsoren aus dem Handwerk in Baden-Württemberg.",
  });
  log("");
  log("— Turn 1 (merken) —");
  log(`toolsExecuted: ${JSON.stringify(turn1.toolsExecuted)}`);
  log(`toolRounds: ${turn1.toolRounds}`);
  log(`reply: ${turn1.reply}`);
  history.push({ role: "user", content: "Merk dir: unsere Firma ist rankpilot, wir machen Lokal-SEO, wir suchen Sponsoren aus dem Handwerk in Baden-Württemberg." });
  history.push({ role: "assistant", content: turn1.reply });

  const firmaAfter = lesenGedaechtnis("firma");
  log(`firma.md nach Turn 1:\n${firmaAfter}`);
  if (!/rankpilot/i.test(firmaAfter) || !/Lokal-SEO|Handwerk|Baden-Württemberg|Baden Wuerttemberg/i.test(firmaAfter)) {
    throw new Error("firma.md enthält die gemerkten Fakten nicht.");
  }
  if (!turn1.toolsExecuted.some((t) => t.name === "gedaechtnis_schreiben" && t.executed)) {
    throw new Error("gedaechtnis_schreiben wurde nicht ausgeführt.");
  }

  const turn2 = await runHeadLoop({
    provider,
    model,
    history,
    context,
    userRequest: "Was für Sponsoren passen zu uns?",
  });
  log("");
  log("— Turn 2 (aus Gedächtnis) —");
  log(`toolsExecuted: ${JSON.stringify(turn2.toolsExecuted)}`);
  log(`reply: ${turn2.reply}`);
  history.push({ role: "user", content: "Was für Sponsoren passen zu uns?" });
  history.push({ role: "assistant", content: turn2.reply });
  if (!/handwerk|baden|lokal|seo|rankpilot/i.test(turn2.reply)) {
    throw new Error("Turn-2-Antwort bezieht sich nicht auf das Gedächtnis.");
  }

  const turn3 = await runHeadLoop({
    provider,
    model,
    history,
    context,
    userRequest: "Und warum die?",
  });
  log("");
  log("— Turn 3 (Bezug auf vorherige Antwort) —");
  log(`reply: ${turn3.reply}`);
  if (turn3.reply.trim().length < 10) {
    throw new Error("Turn-3-Antwort zu kurz.");
  }

  // „Neustart“: neuer Loop, leerer Verlauf, nur Dateien
  const afterRestart = ladeAlleGedaechtnisDateien();
  const turn4 = await runHeadLoop({
    provider,
    model,
    history: [],
    context,
    userRequest: "Was suchen wir nochmal?",
  });
  log("");
  log("— Turn 4 (Neustart, nur Dateien) —");
  log(`firma.md noch da: ${/rankpilot/i.test(afterRestart.firma)}`);
  log(`toolsExecuted: ${JSON.stringify(turn4.toolsExecuted)}`);
  log(`reply: ${turn4.reply}`);
  if (!/sponsor|handwerk|baden|rankpilot|lokal/i.test(turn4.reply)) {
    throw new Error("Nach Neustart fehlt das Gedächtnis in der Antwort.");
  }

  log("");
  log("ERGEBNIS: Phase-1-Kopf-Nachweis bestanden (API, ohne Mikrofon).");
  log("App-Abnahme durch Nutzer in NOVA.app steht noch aus (PTT).");

  const out = path.join(process.cwd(), "docs", "nachweis-phase1-kopf.txt");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
  log(`Geschrieben: ${out}`);

  // Aufräumen Test-Home
  fs.rmSync(tmpHome, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  const out = path.join(process.cwd(), "docs", "nachweis-phase1-kopf.txt");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    `${lines.join("\n")}\nFEHLER: ${error instanceof Error ? error.message : String(error)}\n`,
    "utf8",
  );
  process.exit(1);
});
