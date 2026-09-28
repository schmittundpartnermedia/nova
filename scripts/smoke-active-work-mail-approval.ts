import { PrismaClient } from "@prisma/client";
import { bootstrapAgents } from "@/agents/bootstrap";
import { cancelOpenActiveWorks, loadOpenActiveWork } from "@/services/work/active";
import { startActiveWorkFromIntent, continueActiveWork } from "@/services/work/continue";
import { filterSteerableMailAccounts } from "@/lib/mail/steerable";

bootstrapAgents();
const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "joachim" } });
  if (!org) throw new Error("no org");
  await cancelOpenActiveWorks(org.id);
  await prisma.approvalRequest.updateMany({
    where: { organizationId: org.id, status: "pending" },
    data: { status: "rejected", approvedAt: new Date() },
  });

  const accounts = filterSteerableMailAccounts(
    await prisma.mailAccount.findMany({
      where: { organizationId: org.id, status: "connected" },
    }),
  );
  console.log(
    "steerable",
    accounts.map((a) => a.emailAddress),
  );
  assert(accounts.length >= 1, "mindestens ein steuerbares Mailkonto nötig");
  assert(
    accounts.every((a) => ["info@elevum.io", "joachim@rankpilot.de"].includes(a.emailAddress.toLowerCase())),
    "nur elevum/rankpilot erlaubt",
  );

  const from = accounts.find((a) => a.emailAddress.toLowerCase() === "joachim@rankpilot.de") ?? accounts[0]!;
  const to = from.emailAddress;

  const draft = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "mail",
    goal: "Freigabe-Kette",
    brief: `Schreib eine kurze Mail von ${from.emailAddress} an ${to}. Inhalt: NOVA Freigabe-Kettenprobe, bitte ignorieren.`,
    slots: {
      from: from.emailAddress,
      to,
      subject: "NOVA Freigabe-Kettenprobe",
      body: "NOVA Freigabe-Kettenprobe — bitte ignorieren.",
    },
  });
  console.log("1", draft.statusMessage, "| approval", draft.approvalId, "| from", from.emailAddress);
  assert(draft.approvalId, "Entwurf muss Freigabe erzeugen");
  assert(draft.orbState === "WAITING_FOR_APPROVAL", "Orb muss auf Freigabe warten");
  assert(/rankpilot\.de|elevum\.io/i.test(draft.reply), "Freigabe-Text muss erlaubten Absender zeigen");
  assert(!/icloud|googlemail|sspmedia/i.test(draft.reply), "fremde Absender dürfen nicht erscheinen");

  assert((await loadOpenActiveWork({ organizationId: org.id }))?.status === "waiting_approval", "waiting_approval");

  const rejected = await continueActiveWork({
    organizationId: org.id,
    userRequest: "ablehnen",
  });
  console.log("2", rejected?.statusMessage, "|", (rejected?.reply ?? "").slice(0, 160));
  assert(rejected?.handled, "Ablehnen muss gehandelt werden");
  assert(/nichts versendet|Abgelehnt/i.test(rejected?.reply ?? ""), "Ablehnen darf nicht senden");
  assert(!(await loadOpenActiveWork({ organizationId: org.id })), "nach Ablehnen kein offenes ActiveWork");

  const draft2 = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "mail",
    goal: "Freigabe-Send",
    brief: `Schreib eine kurze Mail von ${from.emailAddress} an ${to}. Inhalt: NOVA Vision Send-Probe, bitte ignorieren.`,
    slots: {
      from: from.emailAddress,
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
  console.log("4", approved?.statusMessage, "|", (approved?.reply ?? "").slice(0, 220));
  assert(approved?.handled, "Freigeben muss gehandelt werden");
  assert(!(await loadOpenActiveWork({ organizationId: org.id })), "nach Freigabe kein offenes ActiveWork mehr");

  console.log(
    JSON.stringify(
      {
        ok: true,
        from: from.emailAddress,
        to,
        sendReply: approved?.reply?.slice(0, 160),
      },
      null,
      2,
    ),
  );
}

main().finally(() => prisma.$disconnect());
