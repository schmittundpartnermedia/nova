/**
 * Nachweis Antwortverhalten (echte API, OHNE Apple Mail): NOVA weiß, was sie kann und was ihr fehlt,
 * und antwortet gesprochen-natürlich – Entwürfe nicht wörtlich vorlesen, keine Formatierung.
 * Wegwerf-DB und -NOVA_HOME (nur Sponsoren-Vorlage, keine Kunden-Vorlage, keine Scanner-Freigabe). Ausgabe: docs/nachweis-antworten.txt
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-nachweis-antworten-"));
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const match = line.match(/^\s*OPENAI_API_KEY\s*=\s*"?([^"\n]*)"?/);
  if (match && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = match[1];
}
process.env.DATABASE_URL = `file:${path.join(tmp, "nachweis.db")}`;
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
const gesprochen = (text: string) => !/\*\*|^#|\n\s*[-*•] /m.test(text);

async function main() {
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { env: process.env, encoding: "utf8" });
  if (push.status !== 0) throw new Error(push.stderr);
  const home = process.env.NOVA_HOME!;
  fs.mkdirSync(path.join(home, "vorlagen"), { recursive: true });
  fs.mkdirSync(path.join(home, "gedaechtnis"), { recursive: true });
  fs.writeFileSync(path.join(home, "vorlagen", "sponsoren.md"), "Betreff: Partnerschaft mit {{firma}}\n\n{{anrede}},\n\nText.\n");
  fs.writeFileSync(path.join(home, "gedaechtnis", "firma.md"), "# Firma\n\n- Unsere Firma heißt rankpilot. Wir machen Lokal-SEO.\n");
  fs.writeFileSync(path.join(home, "signaturen.txt"), "joachim@rankpilot.de = rankpilot Joachim\n");

  const { prisma } = await import("@/lib/prisma");
  const { runHeadLoop, verlaufsInhalt } = await import("@/agents/master/head");
  const { OpenAIProvider } = await import("@/providers/ai/openai");
  const { HEAD_MODEL } = await import("@/providers/ai/models");
  const { encodeMailRef } = await import("@/services/mail/postfach");
  type Postfach = import("@/services/mail/postfach").Postfach;
  const org = await prisma.organization.create({ data: { name: "Nachweis", slug: `nachweis-${Date.now()}` } });
  const ref = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "1", messageId: "<r@revolut>" });
  const mail = {
    ref, konto: "joachim@rankpilot.de", von: "Revolut Business <business@revolut.com>", betreff: "Unterlagen Geschäftskonto",
    eingang: new Date().toISOString(), gelesen: false, an: ["joachim@rankpilot.de"], cc: [],
    textanfang: "Wir benötigen noch einen Handelsregisterauszug.", text: "Guten Tag,\n\nwir benötigen noch einen aktuellen Handelsregisterauszug.\n\nIhr Revolut-Team",
  };
  const postfach: Postfach = {
    neueste: async () => [mail],
    lesen: async (r) => (r === ref ? mail : null),
    senden: async () => ({ ok: false, executed: false, grund: "Nachweis sendet nicht" }),
    antworten: async () => ({ ok: false, executed: false, grund: "Nachweis sendet nicht" }),
  };
  const provider = new OpenAIProvider();
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  const sag = async (satz: string) => {
    const result = await runHeadLoop({ provider, model: HEAD_MODEL, history, userRequest: satz, context: { organizationId: org.id, postfach } });
    log();
    log(`Joachim: ${satz}`);
    log(`Werkzeuge: ${JSON.stringify(result.toolsExecuted)}`);
    log(`NOVA: ${result.reply}`);
    history.push({ role: "user", content: satz }, { role: "assistant", content: verlaufsInhalt(result.reply, result.werkzeugNotiz) });
    return result;
  };

  log(`NOVA Nachweis Antwortverhalten – ${new Date().toISOString()} – Modell ${HEAD_MODEL}, Test-Postfach`);

  const t1 = await sag("Was kannst du eigentlich alles?");
  check(t1.toolsExecuted.some((t) => t.name === "nova_status"), "Selbstauskunft aus dem echten Zustand geholt");
  check(/mail/i.test(t1.reply) && /(kunde|kampagne)/i.test(t1.reply), "nennt Mails und Kunden/Kampagnen");
  check(gesprochen(t1.reply), "gesprochene Antwort ohne Listen/Fettdruck");

  const t2 = await sag("Und was brauchst du noch von mir?");
  check(/kunden.?vorlage|vorlage.*kunden/i.test(t2.reply), "sagt, dass die Kunden-Vorlage fehlt");
  check(/scanner|lead/i.test(t2.reply) && /freigabe/i.test(t2.reply), "sagt, dass die Scanner-Freigabe fehlt");
  check(gesprochen(t2.reply), "gesprochene Antwort ohne Listen/Fettdruck");

  await sag("Check meine Mails.");
  const t4 = await sag("Antworte Revolut, dass der Auszug diese Woche kommt.");
  const entwurf = await prisma.communication.findFirst({ where: { organizationId: org.id, status: "draft" } });
  check(Boolean(entwurf), "Entwurf angelegt");
  check(!t4.reply.includes(entwurf!.body.split("\n").find((z) => z.trim().length > 25) ?? "§§§"), "Entwurf nicht wörtlich vorgelesen");
  check(t4.reply.length < 400 && gesprochen(t4.reply), "kurze, gesprochene Antwort");

  log();
  log("ERGEBNIS: Nachweis Antwortverhalten bestanden (echte API, Test-Postfach).");
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    log(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(path.join(process.cwd(), "docs", "nachweis-antworten.txt"), `${lines.join("\n")}\n`, "utf8");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
