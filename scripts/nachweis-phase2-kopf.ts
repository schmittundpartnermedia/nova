/**
 * Nachweis Phase 2 (Kopf + Mail-Werkzeuge) gegen das echte Modell – OHNE Apple Mail:
 * Das Postfach ist ein Test-Postfach mit zwei Mails; Datenbank und NOVA_HOME sind Wegwerf-Kopien.
 * Spielt die Abnahmesätze durch und prüft, was der Kopf mit den Werkzeugen macht.
 * Ausgabe: docs/nachweis-phase2-kopf.txt
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-nachweis-p2-"));
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const match = line.match(/^\s*OPENAI_API_KEY\s*=\s*"?([^"\n]*)"?/);
  if (match && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = match[1];
}
process.env.DATABASE_URL = `file:${path.join(tmp, "nachweis.db")}`;
process.env.NOVA_HOME = path.join(tmp, "home");

const lines: string[] = [];
function log(line = "") {
  lines.push(line);
  console.log(line);
}
function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
  log(`  ✓ ${message}`);
}

async function main() {
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: process.env,
    encoding: "utf8",
  });
  if (push.status !== 0) throw new Error(`Nachweis-Datenbank konnte nicht angelegt werden:\n${push.stderr}`);

  const { prisma } = await import("@/lib/prisma");
  const { runHeadLoop, verlaufsInhalt } = await import("@/agents/master/head");
  const { OpenAIProvider } = await import("@/providers/ai/openai");
  const { HEAD_MODEL } = await import("@/providers/ai/models");
  const { encodeMailRef } = await import("@/services/mail/postfach");
  type Postfach = import("@/services/mail/postfach").Postfach;
  type MailVoll = import("@/services/mail/postfach").MailVoll;

  const org = await prisma.organization.create({ data: { name: "Nachweis", slug: `nachweis-${Date.now()}` } });
  const ref1 = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "101", messageId: "<a@revolut>" });
  const ref2 = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "102", messageId: "<b@handwerk>" });
  const mails: MailVoll[] = [
    {
      ref: ref1,
      konto: "joachim@rankpilot.de",
      von: "Revolut Business <business@revolut.com>",
      betreff: "Rückfrage zu Ihrem Geschäftskonto",
      eingang: "2026-09-29T08:12:00.000Z",
      gelesen: false,
      an: ["joachim@rankpilot.de"],
      cc: [],
      textanfang: "Guten Tag Herr Schmitt, wir benötigen noch Unterlagen …",
      text: "Guten Tag Herr Schmitt,\n\nwir benötigen für Ihr Geschäftskonto noch einen aktuellen Handelsregisterauszug. Bitte senden Sie ihn uns bis Ende Oktober.\n\nViele Grüße\nIhr Revolut-Business-Team",
    },
    {
      ref: ref2,
      konto: "joachim@rankpilot.de",
      von: "Elektro Maier <info@elektro-maier.de>",
      betreff: "Angebot Lokal-SEO",
      eingang: "2026-09-29T07:40:00.000Z",
      gelesen: true,
      an: ["joachim@rankpilot.de"],
      cc: [],
      textanfang: "Hallo Joachim, danke für das Angebot …",
      text: "Hallo Joachim,\n\ndanke für das Angebot. Wir schauen es uns an.\n\nGruß\nThomas Maier",
    },
  ];
  const versand: Array<{ art: string; input: unknown }> = [];
  const postfach: Postfach = {
    neueste: async (input) => mails.filter((m) => !input.nurUngelesen || !m.gelesen).slice(0, input.anzahl),
    lesen: async (ref) => mails.find((m) => m.ref === ref) ?? null,
    senden: async (input) => {
      versand.push({ art: "senden", input });
      return { ok: true, executed: true, messageId: "<test-senden>", grund: "Test-Postfach: angenommen." };
    },
    antworten: async (input) => {
      versand.push({ art: "antworten", input });
      return { ok: true, executed: true, messageId: "<test-antwort>", grund: "Test-Postfach: angenommen." };
    },
  };

  const provider = new OpenAIProvider();
  const context = { organizationId: org.id, postfach };
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  async function sag(satz: string) {
    const result = await runHeadLoop({ provider, model: HEAD_MODEL, history, userRequest: satz, context });
    log();
    log(`Joachim: ${satz}`);
    log(`Werkzeuge: ${JSON.stringify(result.toolsExecuted)}`);
    log(`NOVA: ${result.reply}`);
    history.push({ role: "user", content: satz }, { role: "assistant", content: verlaufsInhalt(result.reply, result.werkzeugNotiz) });
    return result;
  }
  const entwuerfe = () =>
    prisma.communication.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" } });

  log(`NOVA Phase-2-Nachweis Kopf/Mail – ${new Date().toISOString()}`);
  log(`Modell: ${HEAD_MODEL} (echte API). Postfach: Test-Postfach (kein Apple Mail). DB/NOVA_HOME: Wegwerf-Kopie.`);

  const t1 = await sag("Check meine Mails.");
  check(t1.toolsExecuted.some((t) => t.name === "mail_lesen"), "mail_lesen aufgerufen");
  check(/revolut/i.test(t1.reply) && /maier/i.test(t1.reply), "Zusammenfassung nennt beide Absender");

  const t2 = await sag("Antworte auf die von Revolut: wir melden uns nächste Woche.");
  const nach2 = await entwuerfe();
  check(t2.toolsExecuted.some((t) => t.name === "mail_antworten" && t.executed), "Antwort-Entwurf angelegt");
  check(nach2.length === 1 && nach2[0]!.toAddress === "business@revolut.com", "Empfänger aus Originalmail");
  check(nach2[0]!.replyRef === ref1, "Entwurf bezieht sich auf die Revolut-Mail");
  check(t2.reply.includes(nach2[0]!.body.split("\n")[0]!.trim()), "Entwurf wird vorgelesen (Text in der Antwort)");
  check(versand.length === 0, "nichts gesendet");

  const t3 = await sag("Mach es kürzer.");
  const nach3 = await entwuerfe();
  const aktuell = nach3.filter((row) => row.status === "draft");
  check(t3.toolsExecuted.some((t) => t.name === "mail_antworten" && t.executed), "neuer Antwort-Entwurf");
  check(aktuell.length === 1 && nach3.some((row) => row.status === "superseded"), "alter Entwurf ersetzt, genau einer aktuell");
  check(aktuell[0]!.body.length < nach2[0]!.body.length, "neuer Entwurf ist kürzer");
  check(versand.length === 0, "nichts gesendet");

  const t4 = await sag("Senden.");
  if (versand.length === 0) {
    check(t4.toolsExecuted.some((t) => t.name === "mail_senden" && !t.executed), "ohne Dauerfreigabe: Rückfrage statt Versand");
    await sag("Ja.");
  }
  const gesendet = (await entwuerfe()).filter((row) => row.status === "sent");
  check(versand.length === 1 && versand[0]!.art === "antworten", "genau eine Antwort an das Postfach übergeben");
  check(gesendet.length === 1 && gesendet[0]!.id === aktuell[0]!.id, "der aktuelle Entwurf ist als gesendet markiert");

  log();
  log("— Dauerfreigabe per Stimme —");
  const t5 = await sag("Du darfst ab jetzt Mails senden, wenn ich ‚senden‘ sage.");
  check(t5.toolsExecuted.some((t) => t.name === "freigabe_mail_dauer" && t.executed), "Dauerfreigabe gespeichert");
  check((await prisma.approvalPolicy.count({ where: { organizationId: org.id, actionType: "mail.send", revokedAt: null } })) === 1, "genau eine aktive Dauerfreigabe mail.send");
  await sag("Antworte Thomas Maier: danke, ich rufe ihn morgen an.");
  const vorher = versand.length;
  const t7 = await sag("Senden.");
  check(t7.toolsExecuted.some((t) => t.name === "mail_senden" && t.executed), "mit Dauerfreigabe: gesendet ohne Rückfrage");
  check(versand.length === vorher + 1, "genau eine weitere Mail an das Postfach übergeben");
  check((versand.at(-1)!.input as { an: string }).an === "info@elektro-maier.de", "an Elektro Maier");

  log();
  log("ERGEBNIS: Phase-2-Kopf-Nachweis bestanden (echte API, Test-Postfach).");
  log("Nicht geprüft: Apple Mail selbst (Lesen, Senden, Ordner Gesendet) – das prüft Joachim in NOVA.app.");
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    log(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(path.join(process.cwd(), "docs", "nachweis-phase2-kopf.txt"), `${lines.join("\n")}\n`, "utf8");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
