/**
 * Nachweis Phase 3 (Kampagne) gegen das echte Modell – OHNE Apple Mail:
 * Test-Postfach, Wegwerf-Datenbank und -NOVA_HOME mit Kopie der echten Sponsoren-Vorlage.
 * Der Hintergrund-Läufer wird hier direkt aufgerufen (Handler mail.send / Postfach-Wache).
 * Ausgabe: docs/nachweis-phase3-kopf.txt
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const echteVorlage = path.join(os.homedir(), "Nova", "vorlagen", "sponsoren.md");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-nachweis-p3-"));
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
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { env: process.env, encoding: "utf8" });
  if (push.status !== 0) throw new Error(`Nachweis-Datenbank konnte nicht angelegt werden:\n${push.stderr}`);
  const home = process.env.NOVA_HOME!;
  fs.mkdirSync(path.join(home, "vorlagen"), { recursive: true });
  fs.mkdirSync(path.join(home, "kampagnen"), { recursive: true });
  fs.copyFileSync(echteVorlage, path.join(home, "vorlagen", "sponsoren.md"));
  fs.writeFileSync(path.join(home, "signaturen.txt"), "joachim@rankpilot.de = rankpilot Joachim\n");
  fs.writeFileSync(
    path.join(home, "kampagnen", "test.csv"),
    [
      "firma;anrede;email;bereich",
      "Testfirma A;Sehr geehrtes Testfirma-A-Team;test-a@example.com;Unternehmensversicherungen",
      "Testfirma B;Sehr geehrtes Testfirma-B-Team;test-b@example.com;Business-Telefonie",
      "Testfirma C;Sehr geehrtes Testfirma-C-Team;test-c@example.com;Handwerkersoftware",
    ].join("\n"),
  );

  const { prisma } = await import("@/lib/prisma");
  const { runHeadLoop, verlaufsInhalt } = await import("@/agents/master/head");
  const { OpenAIProvider } = await import("@/providers/ai/openai");
  const { HEAD_MODEL } = await import("@/providers/ai/models");
  const { mailSendHandler } = await import("@/services/mail/send-work");
  const { postfachWache } = await import("@/services/kampagnen/wache");
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  const { encodeMailRef, decodeMailRef } = await import("@/services/mail/postfach");
  type Postfach = import("@/services/mail/postfach").Postfach;
  type MailVoll = import("@/services/mail/postfach").MailVoll;

  const org = await prisma.organization.create({ data: { name: "Nachweis", slug: `nachweis-${Date.now()}` } });
  const versand: Array<{ art: string; an: string; betreff: string; text: string }> = [];
  let posteingang: Array<MailVoll & { bezuege?: string[]; automatisch?: boolean }> = [];
  const postfach: Postfach = {
    neueste: async (input) => posteingang.slice(0, input.anzahl),
    eingang: async (input) =>
      posteingang
        .filter((mail) => new Date(mail.eingang) >= input.seit)
        .map((mail) => ({ ...mail, messageId: (decodeMailRef(mail.ref)?.messageId ?? "").replace(/^<|>$/g, "").toLowerCase(), bezuege: mail.bezuege ?? [], automatisch: mail.automatisch ?? false })),
    lesen: async (ref) => posteingang.find((mail) => mail.ref === ref) ?? null,
    senden: async (input) => {
      versand.push({ art: "senden", an: input.an, betreff: input.betreff, text: input.text });
      return { ok: true, executed: true, messageId: `<k${versand.length}@test>`, grund: "Test-Postfach: angenommen." };
    },
    antworten: async (input) => {
      versand.push({ art: "antworten", an: input.an, betreff: input.betreff, text: input.text });
      return { ok: true, executed: true, messageId: `<a${versand.length}@test>`, grund: "Test-Postfach: angenommen." };
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
  const handler = mailSendHandler(postfach);

  log(`NOVA Phase-3-Nachweis Kampagne – ${new Date().toISOString()}`);
  log(`Modell: ${HEAD_MODEL} (echte API). Postfach: Test-Postfach (kein Apple Mail). Vorlage: Kopie von ~/Nova/vorlagen/sponsoren.md.`);

  const t1 = await sag("Schreib die Firmen aus der Liste test mit der Sponsoren-Vorlage an, eine Mail pro Minute, von joachim@rankpilot.de.");
  check(t1.toolsExecuted.some((t) => t.name === "kampagne_planen" && t.executed), "Kampagne geplant");
  check(!t1.toolsExecuted.some((t) => t.name === "kampagne_starten"), "noch nicht gestartet");
  check(/\b(3|drei)\b/i.test(t1.reply) && /los|starten|\?/i.test(t1.reply), "Zusammenfassung mit Anzahl und Rückfrage");
  check(versand.length === 0, "nichts gesendet");

  const t2 = await sag("Ja, los.");
  check(t2.toolsExecuted.some((t) => t.name === "kampagne_starten" && t.executed), "Kampagne gestartet");
  const items = await prisma.workItem.findMany({ where: { kind: "mail.send" }, orderBy: { runAt: "asc" } });
  check(items.length === 3 && items[1]!.runAt.getTime() - items[0]!.runAt.getTime() === 60_000, "3 Work-Items im Minutenabstand");

  log();
  log("— Hintergrund-Läufer verschickt (Handler direkt aufgerufen) —");
  for (const item of items) {
    const result = await handler({ id: item.id, organizationId: org.id, jobId: null, kind: "mail.send", payload: JSON.parse(item.payload), attempts: 0 });
    log(`  mail.send ${item.id}: ${result.ok ? "ok" : "fehlgeschlagen"} – ${result.note}`);
  }
  check(versand.length === 3, "3 Mails an das Postfach übergeben");
  check(versand.every((mail) => !/\{\{/.test(mail.text + mail.betreff)), "alle Platzhalter gefüllt");
  check(versand[1]!.betreff.endsWith("mit Testfirma B") && versand[1]!.text.startsWith("Sehr geehrtes Testfirma-B-Team,"), "Mail an B personalisiert");
  log(`  Beispiel an ${versand[0]!.an}: „${versand[0]!.betreff}“`);
  const fertig = await holeNeueMeldungen(org.id);
  check(fertig.length === 1 && /Alle 3 Mails sind raus/.test(fertig[0]!.text), `Abschlussmeldung: „${fertig[0]?.text}“`);
  history.push({ role: "assistant", content: fertig[0]!.text });

  await sag("Wie ist der Stand der Kampagne?");

  log();
  log("— Antwort von Testfirma B geht ein, Postfach-Wache läuft —");
  const b = await prisma.communication.findFirstOrThrow({ where: { toAddress: "test-b@example.com", direction: "outbound" } });
  const ref = encodeMailRef({ kontoId: "K1", postfach: "INBOX", nachrichtId: "700", messageId: "<antwort-b@example.com>" });
  posteingang = [
    {
      ref,
      konto: "joachim@rankpilot.de",
      von: "Maria Berg <test-b@example.com>",
      betreff: `Re: ${b.subject}`,
      eingang: new Date(b.sentAt!.getTime() + 120_000).toISOString(),
      gelesen: false,
      an: ["joachim@rankpilot.de"],
      cc: [],
      textanfang: "Hallo Herr Schmitt, klingt interessant.",
      text: "Hallo Herr Schmitt,\n\nklingt interessant. Können Sie mir Unterlagen zu den Paketen schicken? Ein Gespräch nächste Woche wäre möglich.\n\nViele Grüße\nMaria Berg\nTestfirma B",
    },
  ];
  const wache = await postfachWache({ organizationId: org.id, postfach, kopf: { provider, model: HEAD_MODEL } });
  check(wache.neueAntworten === 1, "Antwort erkannt");
  const vorschlag = await holeNeueMeldungen(org.id);
  check(vorschlag.length === 1, "Nutzer wird angesprochen");
  log(`NOVA (Meldung): ${vorschlag[0]!.text}`);
  check(/Testfirma B|Berg/.test(vorschlag[0]!.text) && /send|ergänz/i.test(vorschlag[0]!.text), "Meldung nennt Firma und fragt, ob senden oder ergänzen");
  check(versand.length === 3, "Wache hat nichts gesendet");
  const meldungZeile = await prisma.conversationMessage.findFirstOrThrow({ where: { id: vorschlag[0]!.id } });
  const notiz = (JSON.parse(meldungZeile.metadata ?? "{}") as { werkzeuge?: string }).werkzeuge;
  history.push({ role: "assistant", content: verlaufsInhalt(vorschlag[0]!.text, notiz) });

  await sag("Ergänze noch, dass ich die Unterlagen bis Freitag schicke.");
  const t6 = await sag("Senden.");
  if (!t6.toolsExecuted.some((t) => t.name === "mail_senden" && t.executed)) await sag("Ja.");
  const antwort = versand.at(-1)!;
  check(versand.length === 4 && antwort.art === "antworten" && antwort.an === "test-b@example.com", "Antwort an Testfirma B raus");
  check(/freitag/i.test(antwort.text), "Ergänzung ist drin");

  log();
  log("ERGEBNIS: Phase-3-Kopf-Nachweis bestanden (echte API, Test-Postfach, Worker-Handler direkt aufgerufen).");
  log("Nicht geprüft: Apple Mail, echter Hintergrund-Läufer mit Wartezeiten, Neustart der App – das prüft Joachim in NOVA.app.");
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    log(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(path.join(process.cwd(), "docs", "nachweis-phase3-kopf.txt"), `${lines.join("\n")}\n`, "utf8");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
