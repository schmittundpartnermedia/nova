/**
 * Regressionstest „Was hat gewirkt?“ – ohne Netz, ohne App, ohne Apple Mail.
 * Kurzlink je Kampagnen-Mail, Zuordnung der Checks aus der App zu Mail und Kampagne, Tagesbericht.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-wirkung-"));
process.env.DATABASE_URL = `file:${path.join(tmp, "test.db")}`;
process.env.NOVA_HOME = path.join(tmp, "home");
delete process.env.RANKPILOT_CHECKS_TOKEN;

async function main() {
  const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], { env: process.env, encoding: "utf8" });
  if (push.status !== 0) throw new Error(`Test-Datenbank konnte nicht angelegt werden:\n${push.stderr}`);

  const { prisma } = await import("@/lib/prisma");
  const { markiereCheckLinks, codeAusLink, appCheckQuelle } = await import("@/lib/rankpilot/checks");
  const { erstelleEntwurf } = await import("@/services/mail/entwuerfe");
  const { wirkung } = await import("@/services/wirkung");
  const { schreibeTagesbericht } = await import("@/services/tagesbericht");
  type CheckQuelle = import("@/lib/rankpilot/checks").CheckQuelle;

  const org = await prisma.organization.create({ data: { name: "Test", slug: `test-${Date.now()}` } });
  const kampagne = await prisma.campaign.create({
    data: { organizationId: org.id, name: "Schreinereien Pforzheim", vorlage: "kunden", liste: "x", absender: "joachim@rankpilot.de", abstandMinuten: 5, status: "fertig", approvalId: "a" },
  });
  const text = "Guten Tag,\n\nhier der Check:\nhttps://rankpilot.de/check\n\nGruß";

  const tests: Array<[string, () => Promise<void>]> = [
    ["Kurzlink: nur der nackte Check-Link bekommt den Code", async () => {
      const a = markiereCheckLinks("Link: https://rankpilot.de/check und https://rankpilot.de/check.", "ab12cd34");
      assert.equal(a.text, "Link: https://rankpilot.de/check?c=ab12cd34 und https://rankpilot.de/check?c=ab12cd34.");
      assert.equal(a.link, "https://rankpilot.de/check?c=ab12cd34");
      assert.equal(markiereCheckLinks("https://rankpilot.de/checkout und https://rankpilot.de/check/r/1", "x1y2").link, null);
      assert.equal(markiereCheckLinks("https://rankpilot.de/check?c=alt1", "neu1").link, null, "schon markierte Links bleiben");
      assert.equal(codeAusLink("https://rankpilot.de/check?c=ab12cd34"), "ab12cd34");
      assert.equal(codeAusLink(null), null);
    }],
    ["Kampagnen-Entwurf bekommt eigenen Link, einzelne Mail nicht", async () => {
      const k = await erstelleEntwurf({ organizationId: org.id, absender: "joachim@rankpilot.de", an: "a@a.de", betreff: "B", text, kampagneId: kampagne.id, empfaengerName: "Schreinerei A" });
      const zeile = await prisma.communication.findUniqueOrThrow({ where: { id: k.id } });
      const code = codeAusLink(zeile.externalUrl);
      assert.ok(code);
      assert.match(zeile.body, new RegExp(`https://rankpilot\\.de/check\\?c=${code}\\n`));
      const e = await erstelleEntwurf({ organizationId: org.id, absender: "joachim@rankpilot.de", an: "b@b.de", betreff: "B", text });
      const einzeln = await prisma.communication.findUniqueOrThrow({ where: { id: e.id } });
      assert.equal(einzeln.externalUrl, null);
      assert.match(einzeln.body, /https:\/\/rankpilot\.de\/check\n/);
    }],
    ["Wirkung: Checks werden Mail und Kampagne zugeordnet, Konten und Antworten gezählt", async () => {
      const heute = new Date();
      const b = await erstelleEntwurf({ organizationId: org.id, absender: "joachim@rankpilot.de", an: "c@c.de", betreff: "B", text, kampagneId: kampagne.id, empfaengerName: "Schreinerei C" });
      await prisma.communication.updateMany({ where: { campaignId: kampagne.id }, data: { status: "sent", sentAt: heute } });
      await prisma.communication.create({
        data: { organizationId: org.id, channel: "email", direction: "inbound", subject: "Re", body: "Ja", status: "received", campaignId: kampagne.id, recipientName: "Schreinerei A" },
      });
      await prisma.communication.create({
        data: { organizationId: org.id, channel: "email", direction: "inbound", subject: "Abwesend", body: "", status: "autoreply", campaignId: kampagne.id },
      });
      const alle = await prisma.communication.findMany({ where: { campaignId: kampagne.id, direction: "outbound" }, orderBy: { createdAt: "asc" } });
      const codeA = codeAusLink(alle[0]!.externalUrl)!;
      const codeC = codeAusLink((await prisma.communication.findUniqueOrThrow({ where: { id: b.id } })).externalUrl)!;
      const quelle: CheckQuelle = async () => ({
        eingerichtet: true,
        checks: [
          { id: "rpc_1", code: codeA, status: "ok", website: "a.de", ort: "Pforzheim", konto_angelegt: true, erstellt: heute.toISOString() },
          { id: "rpc_2", code: codeC, status: "ok", website: "c.de", ort: "Pforzheim", konto_angelegt: false, erstellt: heute.toISOString() },
          { id: "rpc_3", code: "fremd123", status: "ok", website: "x.de", ort: null, konto_angelegt: false, erstellt: heute.toISOString() },
        ],
      });
      const w = await wirkung({ organizationId: org.id, seit: new Date(heute.getTime() - 86_400_000), quelle });
      assert.equal(w.checks_eingerichtet, true);
      assert.deepEqual(w.kampagnen, [{ name: "Schreinereien Pforzheim", gesendet: 2, antworten: 1, checks: 2, konten: 1 }]);
      assert.deepEqual(w.checks.map((c) => [c.firma, c.konto_angelegt]), [["Schreinerei A", true], ["Schreinerei C", false]]);
      assert.equal(w.ohne_zuordnung, 1);

      const bericht = await schreibeTagesbericht({
        organizationId: org.id,
        datum: `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`,
        melden: false,
        checkQuelle: quelle,
      });
      const inhalt = fs.readFileSync(bericht.datei, "utf8");
      assert.match(inhalt, /## Gestartete rankPilot Checks/);
      assert.match(inhalt, /Schreinerei A \(Schreinereien Pforzheim\), Konto angelegt/);
      assert.match(bericht.kurz, /2 Checks über meine Mails gestartet/);
      assert.match(inhalt, /1 Antworten eingegangen, 1 Abwesenheitsnotizen/);
    }],
    ["Ohne Schlüssel: ehrlicher Hinweis statt Zahl, keine Netzabfrage", async () => {
      assert.deepEqual(await appCheckQuelle(new Date()), { eingerichtet: false, grund: "RANKPILOT_CHECKS_TOKEN fehlt in NOVAs .env" });
      const w = await wirkung({ organizationId: org.id, seit: new Date(Date.now() - 86_400_000) });
      assert.equal(w.checks_eingerichtet, false);
      assert.match(w.hinweis ?? "", /Checks werden noch nicht gezählt: RANKPILOT_CHECKS_TOKEN fehlt/);
      assert.equal(w.kampagnen[0]!.checks, 0);
    }],
  ];

  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}`);
      console.log(error instanceof Error ? error.message : error);
    }
  }
  await prisma.$disconnect();
  console.log(failed ? `${failed} von ${tests.length} fehlgeschlagen` : `alle ${tests.length} bestanden`);
  return failed;
}

main()
  .then((failed) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  })
  .catch((error) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.error(error);
    process.exit(1);
  });
