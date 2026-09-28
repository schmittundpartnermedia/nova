import { PrismaClient } from "@prisma/client";
import { bootstrapAgents } from "@/agents/bootstrap";
import { cancelOpenActiveWorks, loadOpenActiveWork } from "@/services/work/active";
import { startActiveWorkFromIntent, continueActiveWork } from "@/services/work/continue";

bootstrapAgents();
const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error("no org");
  await cancelOpenActiveWorks(org.id);
  await prisma.approvalRequest.updateMany({
    where: { organizationId: org.id, status: "pending" },
    data: { status: "rejected", approvedAt: new Date() },
  });

  const accounts = await prisma.mailAccount.findMany({
    where: { organizationId: org.id, status: "connected" },
    take: 3,
  });
  assert(accounts.length > 0, "mindestens ein Mailkonto nötig");
  const from = accounts[0]!.emailAddress;
  const to = from; // Selbsttest — Freigabe-Kette, kein Fremdversand ohne Freigabe

  const draft = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "mail",
    goal: "Freigabe-Kette",
    brief: `Schreib eine kurze Mail an ${to}. Inhalt: NOVA Freigabe-Kettenprobe, bitte ignorieren.`,
    slots: {
      from,
      to,
      subject: "NOVA Freigabe-Kettenprobe",
      body: "NOVA Freigabe-Kettenprobe — bitte ignorieren.",
    },
  });
  console.log("1", draft.statusMessage, "| approval", draft.approvalId);
  assert(draft.approvalId, "Entwurf muss Freigabe erzeugen");
  assert(draft.orbState === "WAITING_FOR_APPROVAL", "Orb muss auf Freigabe warten");

  const open = await loadOpenActiveWork({ organizationId: org.id });
  assert(open?.status === "waiting_approval", "ActiveWork muss waiting_approval sein");
  assert(open?.linkedIds.approvalId === draft.approvalId, "approvalId muss verlinkt sein");

  // Ablehnen schließt die Kette ohne Versand.
  const rejected = await continueActiveWork({
    organizationId: org.id,
    userRequest: "ablehnen",
  });
  console.log("2", rejected?.statusMessage, "|", (rejected?.reply ?? "").slice(0, 160));
  assert(rejected?.handled, "Ablehnen muss gehandelt werden");
  assert(/nichts versendet|Abgelehnt/i.test(rejected?.reply ?? ""), "Ablehnen darf nicht senden");

  const afterReject = await loadOpenActiveWork({ organizationId: org.id });
  assert(!afterReject, "nach Ablehnen kein offenes ActiveWork");

  // Zweite Kette: Freigabe → Versand (Selbstempfänger).
  const draft2 = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "mail",
    goal: "Freigabe-Send",
    brief: `Schreib eine kurze Mail an ${to}. Inhalt: NOVA Vision Send-Probe, bitte ignorieren.`,
    slots: {
      from,
      to,
      subject: "NOVA Vision Send-Probe",
      body: "NOVA Vision Send-Probe — bitte ignorieren.",
    },
  });
  console.log("3", draft2.statusMessage, "| approval", draft2.approvalId);
  assert(draft2.approvalId, "zweiter Entwurf braucht Freigabe");

  const approved = await continueActiveWork({
    organizationId: org.id,
    userRequest: "freigeben",
  });
  console.log("4", approved?.statusMessage, "|", (approved?.reply ?? "").slice(0, 200));
  assert(approved?.handled, "Freigeben muss gehandelt werden");

  const afterApprove = await loadOpenActiveWork({ organizationId: org.id });
  assert(!afterApprove, "nach Freigabe kein offenes ActiveWork mehr");
  assert(
    /raus|versendet|fehlgeschlagen|kein Mailkonto/i.test(approved?.reply ?? ""),
    `unerwartete Freigabe-Antwort: ${approved?.reply}`,
  );

  console.log(JSON.stringify({ ok: true, from, to, sendReply: approved?.reply?.slice(0, 120) }, null, 2));
}

main().finally(() => prisma.$disconnect());
