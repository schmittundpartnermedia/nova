/**
 * Nachweis Phase 2 (ohne echten Versand, außer Nutzer startet Mail-Test selbst):
 * Tool-Registry, Vorlagenordner, Standing-Peek ohne Limit-Verbrauch.
 * Ausgabe: docs/nachweis-phase2-mail.txt
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureVorlagenDir, listeVorlagenDateien, fuelleVorlage } from "@/lib/mail/vorlagen-files";
import { bootstrapTools, listTools, executeTool } from "@/services/tools/registry";
import { createStandingPolicy, standingApprovalAllows, consumeStandingApproval } from "@/services/approvals";
import { prisma } from "@/lib/prisma";
import { getCurrentTenant } from "@/services/tenant";

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
  log(`NOVA Phase-2-Nachweis Mail – ${new Date().toISOString()}`);
  log(`Host: ${os.hostname()}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-phase2-"));
  process.env.NOVA_HOME = tmp;
  ensureVorlagenDir();
  const vorlagePath = path.join(tmp, "vorlagen", "sponsoren.md");
  fs.writeFileSync(
    vorlagePath,
    `{{anrede}},

kurz zu {{firma}} und {{projekt}}.

Freundliche Grüße
`,
    "utf8",
  );
  log(`Test-Vorlage: ${vorlagePath}`);
  const listed = listeVorlagenDateien();
  log(`Vorlagen: ${listed.map((v) => v.name).join(", ")}`);
  const filled = fuelleVorlage("sponsoren", {
    anrede: "Guten Tag Anna",
    firma: "Muster GmbH",
    vorname: "Anna",
    projekt: "Lokal-SEO",
  });
  log(`Gefüllt:\n${filled.text}`);
  if (!/Muster GmbH/.test(filled.text) || !/Lokal-SEO/.test(filled.text)) {
    throw new Error("Vorlagenfüllung fehlerhaft.");
  }

  bootstrapTools();
  const names = listTools().map((t) => t.name).sort();
  log(`Werkzeuge: ${names.join(", ")}`);
  for (const need of [
    "mail_lesen",
    "mail_entwurf",
    "mail_senden",
    "mail_antworten",
    "vorlage_liste",
    "vorlage_fuellen",
    "freigabe_mail_dauer",
  ]) {
    if (!names.includes(need)) throw new Error(`Werkzeug fehlt: ${need}`);
  }

  const tenant = await getCurrentTenant();
  const orgId = tenant.organizationId;
  log(`Organization: ${orgId}`);

  // Standing-Peek darf Limit nicht verbrauchen
  await createStandingPolicy({
    organizationId: orgId,
    name: "Nachweis Mail Standing",
    actionType: "mail.send.batch",
    limits: { maxPerDay: 5 },
  });
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const before = await prisma.approvalRequest.count({
    where: {
      organizationId: orgId,
      actionType: "mail.send.batch",
      status: "approved",
      approvedAt: { gte: start },
    },
  });
  const peek1 = await standingApprovalAllows({ organizationId: orgId, actionType: "mail.send.batch" });
  const peek2 = await standingApprovalAllows({ organizationId: orgId, actionType: "mail.send.batch" });
  const afterPeek = await prisma.approvalRequest.count({
    where: {
      organizationId: orgId,
      actionType: "mail.send.batch",
      status: "approved",
      approvedAt: { gte: start },
    },
  });
  log(`Standing peek allowed=${peek1.allowed}/${peek2.allowed}, approved-count before=${before} afterPeek=${afterPeek}`);
  if (afterPeek !== before) {
    throw new Error("Peek hat das Tageslimit verbraucht – Bug nicht behoben.");
  }

  const consumed = await consumeStandingApproval({
    organizationId: orgId,
    actionType: "mail.send.batch",
    description: "Nachweis-Verbrauch",
    payload: { nachweis: true },
  });
  const afterConsume = await prisma.approvalRequest.count({
    where: {
      organizationId: orgId,
      actionType: "mail.send.batch",
      status: "approved",
      approvedAt: { gte: start },
    },
  });
  log(`Consume allowed=${consumed.allowed}, approved-count afterConsume=${afterConsume}`);
  if (afterConsume !== before + 1) {
    throw new Error("Consume zählt nicht korrekt.");
  }

  const freigabe = await executeTool(
    "freigabe_mail_dauer",
    { erteilen: true },
    { organizationId: orgId },
  );
  log(`freigabe_mail_dauer: ${JSON.stringify(freigabe)}`);
  if (!freigabe.ok) throw new Error("Dauerfreigabe-Tool fehlgeschlagen.");

  const vorlagen = await executeTool("vorlage_liste", {}, { organizationId: orgId });
  log(`vorlage_liste: ${JSON.stringify(vorlagen.data)}`);

  log("");
  log("ERGEBNIS: Phase-2-Kernnachweis bestanden (Vorlagen, Tools, Standing-Peek).");
  log("Live-Abnahme in NOVA.app (lesen/entwurf/senden) startet der Nutzer selbst.");

  const out = path.join(process.cwd(), "docs", "nachweis-phase2-mail.txt");
  fs.writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
  log(`Geschrieben: ${out}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  const out = path.join(process.cwd(), "docs", "nachweis-phase2-mail.txt");
  fs.writeFileSync(
    out,
    `${lines.join("\n")}\nFEHLER: ${error instanceof Error ? error.message : String(error)}\n`,
    "utf8",
  );
  process.exit(1);
});
