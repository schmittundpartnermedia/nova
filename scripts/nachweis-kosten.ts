/**
 * Nachweis Kostenübersicht (echte API, Wegwerf-DB und -NOVA_HOME): Ein echter Kopf-Aufruf landet im Kostenbuch,
 * „Was hat NOVA heute gekostet?“ nennt die Kosten und sagt ehrlich, wo ein Preis fehlt. Ausgabe: docs/nachweis-kosten.txt
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wegwerfDatenbank } from "./lib/wegwerf-db";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-nachweis-kosten-"));
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const match = line.match(/^\s*OPENAI_API_KEY\s*=\s*"?([^"\n]*)"?/);
  if (match && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = match[1];
}
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
  const { prisma } = await import("@/lib/prisma");
  const { runHeadLoop } = await import("@/agents/master/head");
  const { OpenAIProvider } = await import("@/providers/ai/openai");
  const { HEAD_MODEL } = await import("@/providers/ai/models");
  const { leseBuchungen } = await import("@/lib/kosten");
  const org = await prisma.organization.create({ data: { name: "Nachweis", slug: `nachweis-${Date.now()}` } });
  const postfach = {
    neueste: async () => [], eingang: async () => [], lesen: async () => null,
    senden: async () => ({ ok: false as const, executed: false as const, grund: "" }), antworten: async () => ({ ok: false as const, executed: false as const, grund: "" }),
  };
  log(`NOVA Nachweis Kosten – ${new Date().toISOString()} – Modell ${HEAD_MODEL}`);
  const start = new Date(Date.now() - 1000);
  const r = await runHeadLoop({ provider: new OpenAIProvider(), model: HEAD_MODEL, history: [], userRequest: "Was hat NOVA heute gekostet?", context: { organizationId: org.id, postfach } });
  log(`Joachim: Was hat NOVA heute gekostet?`);
  log(`Werkzeuge: ${JSON.stringify(r.toolsExecuted.map((t) => t.name))}`);
  log(`NOVA: ${r.reply}`);
  const buchungen = leseBuchungen(start, new Date(Date.now() + 1000));
  check(buchungen.some((b) => b.art === "kopf" && (b.eingabeTokens ?? 0) > 0), `echter Kopf-Aufruf im Kostenbuch (${buchungen.length} Buchungen, ${buchungen.reduce((s, b) => s + (b.eingabeTokens ?? 0), 0)} Eingabe-Tokens)`);
  check(r.toolsExecuted.some((t) => t.name === "kosten_anzeigen"), "ruft die Kostenübersicht auf");
  check(/preis|fehlt|nicht bekannt|unbekannt/i.test(r.reply), "sagt ehrlich, dass für das Kopfmodell ein Preis fehlt");
  log();
  log("ERGEBNIS: Nachweis Kosten bestanden (echte API).");
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    log(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(path.join(process.cwd(), "docs", "nachweis-kosten.txt"), `${lines.join("\n")}\n`, "utf8");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
