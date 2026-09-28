import { PrismaClient } from "@prisma/client";
import { bootstrapAgents } from "@/agents/bootstrap";
import { cancelOpenActiveWorks, loadOpenActiveWork } from "@/services/work/active";
import { startActiveWorkFromIntent, continueActiveWork } from "@/services/work/continue";
import { filterSteerableMailAccounts } from "@/lib/mail/steerable";

bootstrapAgents();
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error("no org");
  await cancelOpenActiveWorks(org.id);
  await prisma.communication.deleteMany({
    where: { organizationId: org.id, deliveryStatus: "AWAITING_SENDER" },
  });

  const accounts = filterSteerableMailAccounts(
    await prisma.mailAccount.findMany({
      where: { organizationId: org.id, status: "connected" },
    }),
  );
  console.log(
    "accounts",
    accounts.map((a) => a.emailAddress),
  );
  if (!accounts.length) throw new Error("keine steuerbaren Mailkonten");

  const from = accounts.find((a) => a.emailAddress.toLowerCase() === "joachim@rankpilot.de") ?? accounts[0]!;

  const a = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "mail",
    goal: "Draft only",
    brief: `Schreib einen Mailentwurf von ${from.emailAddress} an ${from.emailAddress}. Inhalt: nur Entwurf, nicht senden.`,
    slots: {
      from: from.emailAddress,
      to: from.emailAddress,
      body: "Nur Entwurf, nicht senden.",
      subject: "NOVA Draft-only ActiveWork",
    },
  });
  console.log("1", a.statusMessage, "|", a.orbState, "| approval", Boolean(a.approvalId));
  console.log(a.reply.slice(0, 240));

  if (
    !a.approvalId &&
    (/von welchem|vorschlag|würde von|passt das|Absender/i.test(a.reply) || a.statusMessage.includes("Absender"))
  ) {
    const pick = `von ${from.emailAddress}`;
    const b = await continueActiveWork({ organizationId: org.id, userRequest: pick });
    console.log("2", b?.statusMessage, "|", b?.orbState, "| approval", Boolean(b?.approvalId));
    console.log((b?.reply ?? "").slice(0, 280));
  }

  const open = await loadOpenActiveWork({ organizationId: org.id });
  console.log("open", open?.status ?? "none");
}

main().finally(() => prisma.$disconnect());
