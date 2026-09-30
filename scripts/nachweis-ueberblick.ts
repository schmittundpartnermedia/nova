/**
 * Nachweis Tagesüberblick und Wirkung (echte API, OHNE Apple Mail, OHNE rankPilot-App):
 * „Was liegt heute an?“ → NOVA holt den Überblick und sagt kurz, was wartet und was läuft.
 * „Was haben die Mails gebracht?“ → NOVA zählt ehrlich und sagt, dass Checks noch nicht gezählt werden.
 * Wegwerf-DB und -NOVA_HOME. Ausgabe: docs/nachweis-ueberblick.txt
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-nachweis-ueberblick-"));
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const match = line.match(/^\s*OPENAI_API_KEY\s*=\s*"?([^"\n]*)"?/);
  if (match && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = match[1];
}
process.env.DATABASE_URL = `file:${path.join(tmp, "nachweis.db")}`;
process.env.NOVA_HOME = path.join(tmp, "home");
delete process.env.RANKPILOT_CHECKS_TOKEN;
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
  fs.mkdirSync(path.join(home, "gedaechtnis"), { recursive: true });
  fs.mkdirSync(path.join(home, "claude", "auftraege"), { recursive: true });
  fs.writeFileSync(path.join(home, "gedaechtnis", "firma.md"), "# Firma\n\n- Unsere Firma heißt rankpilot. Wir machen Lokal-SEO.\n");

  const { prisma } = await import("@/lib/prisma");
  const { runHeadLoop, verlaufsInhalt } = await import("@/agents/master/head");
  const { OpenAIProvider } = await import("@/providers/ai/openai");
  const { HEAD_MODEL } = await import("@/providers/ai/models");
  type Postfach = import("@/services/mail/postfach").Postfach;
  const org = await prisma.organization.create({ data: { name: "Nachweis", slug: `nachweis-${Date.now()}` } });

  const gestern = new Date(Date.now() - 20 * 3_600_000);
  const kampagne = await prisma.campaign.create({
    data: { organizationId: org.id, name: "Schreinereien Pforzheim", vorlage: "kunden", liste: "x", absender: "joachim@rankpilot.de", abstandMinuten: 5, status: "laeuft", approvalId: "a", startedAt: gestern },
  });
  for (const [firma, an] of [["Schreinerei Zimmermann", "z@z.de"], ["Ehrismann", "e@e.de"], ["Boch GmbH", "b@b.de"]]) {
    await prisma.communication.create({
      data: { organizationId: org.id, channel: "email", direction: "outbound", subject: "Wird … empfohlen?", body: "…", status: "sent", sentAt: gestern, campaignId: kampagne.id, recipientName: firma, toAddress: an, externalUrl: "https://rankpilot.de/check?c=abcd1234" },
    });
  }
  await prisma.communication.create({
    data: { organizationId: org.id, channel: "email", direction: "outbound", subject: "Nächste", body: "…", status: "draft", campaignId: kampagne.id, recipientName: "Wörtz", toAddress: "w@w.de" },
  });
  await prisma.communication.create({
    data: { organizationId: org.id, channel: "email", direction: "inbound", subject: "Re: Wird Ehrismann empfohlen?", body: "Klingt interessant, rufen Sie mich an.", status: "received", campaignId: kampagne.id, recipientName: "Ehrismann", fromAddress: "e@e.de", replyRef: "ref-1" },
  });
  await prisma.communication.create({
    data: { organizationId: org.id, channel: "email", direction: "outbound", subject: "Re: Wird Ehrismann empfohlen?", body: "Gern, ich rufe Sie morgen an.", status: "draft", toAddress: "e@e.de", replyRef: "ref-1" },
  });
  fs.writeFileSync(path.join(home, "claude", "auftraege", "a1.json"), JSON.stringify({
    id: "a1", organizationId: org.id, projekt: "rankpilot-website", aufgabe: "Im Footer die Öffnungszeiten ergänzen", abnahmekriterium: "x",
    branch: "nova/a1", status: "fertig", erstellt: new Date().toISOString(),
  }));

  const postfach: Postfach = {
    neueste: async () => [
      { ref: "m1", konto: "joachim@rankpilot.de", von: "Steuerbüro Kern <kern@stb.de>", betreff: "Unterlagen Umsatzsteuer", eingang: new Date().toISOString(), gelesen: false, textanfang: "" },
      { ref: "m2", konto: "joachim@rankpilot.de", von: "news@shop.de", betreff: "Newsletter Oktober", eingang: new Date().toISOString(), gelesen: false, textanfang: "" },
    ],
    eingang: async () => [],
    lesen: async () => null,
    senden: async () => ({ ok: false, executed: false, grund: "Nachweis sendet nicht" }),
    antworten: async () => ({ ok: false, executed: false, grund: "Nachweis sendet nicht" }),
  };
  const provider = new OpenAIProvider();
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  const sag = async (satz: string) => {
    const result = await runHeadLoop({ provider, model: HEAD_MODEL, history, userRequest: satz, context: { organizationId: org.id, postfach } });
    log();
    log(`Joachim: ${satz}`);
    log(`Werkzeuge: ${JSON.stringify(result.toolsExecuted.map((t) => t.name))}`);
    log(`NOVA: ${result.reply}`);
    history.push({ role: "user", content: satz }, { role: "assistant", content: verlaufsInhalt(result.reply, result.werkzeugNotiz) });
    return result;
  };

  log(`NOVA Nachweis Tagesüberblick und Wirkung – ${new Date().toISOString()} – Modell ${HEAD_MODEL}, Test-Postfach, ohne rankPilot-App`);

  const t1 = await sag("Guten Morgen, was liegt heute an?");
  check(t1.toolsExecuted.some((t) => t.name === "tagesueberblick"), "Überblick aus dem echten Zustand geholt");
  check(/ehrismann/i.test(t1.reply), "nennt die offene Antwort von Ehrismann");
  check(/claude|webseite|footer|live/i.test(t1.reply), "nennt den fertigen Claude-Auftrag");
  check(gesprochen(t1.reply), "gesprochene Antwort ohne Listen/Fettdruck");
  check(t1.reply.length < 900, `kurz genug zum Vorlesen (${t1.reply.length} Zeichen)`);

  const t2 = await sag("Und was haben die Mails bisher gebracht?");
  check(t2.toolsExecuted.some((t) => t.name === "wirkung_anzeigen" || t.name === "tagesueberblick"), "Zahlen aus dem echten Zustand geholt");
  check(/noch nicht|nicht gezählt|nicht eingerichtet|schlüssel/i.test(t2.reply), "sagt ehrlich, dass Checks noch nicht gezählt werden");
  check(gesprochen(t2.reply), "gesprochene Antwort ohne Listen/Fettdruck");

  log();
  log("ERGEBNIS: Nachweis Tagesüberblick und Wirkung bestanden (echte API, Test-Postfach, ohne App).");
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    log(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(path.join(process.cwd(), "docs", "nachweis-ueberblick.txt"), `${lines.join("\n")}\n`, "utf8");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
