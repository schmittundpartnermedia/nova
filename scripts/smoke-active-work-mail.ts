import { PrismaClient } from "@prisma/client";
import { bootstrapAgents } from "@/agents/bootstrap";
import { cancelOpenActiveWorks, loadOpenActiveWork } from "@/services/work/active";
import { startActiveWorkFromIntent, continueActiveWork } from "@/services/work/continue";

bootstrapAgents();
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error("no org");
  await cancelOpenActiveWorks(org.id);
  await prisma.communication.deleteMany({
    where: { organizationId: org.id, deliveryStatus: "AWAITING_SENDER" },
  });

  const accounts = await prisma.mailAccount.findMany({
    where: { organizationId: org.id, status: "connected" },
    take: 3,
  });
  console.log("accounts", accounts.map((a) => a.emailAddress));

  // Self-address draft only — no approval, no send.
  const a = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "mail",
    goal: "Draft only",
    brief: "Schreib einen Mailentwurf an draft-test@example.com. Inhalt: nur Entwurf, nicht senden.",
    slots: {
      to: "draft-test@example.com",
      body: "Nur Entwurf, nicht senden.",
      subject: "NOVA Draft-only ActiveWork",
    },
  });
  console.log("1", a.statusMessage, "|", a.orbState, "| approval", Boolean(a.approvalId));
  console.log(a.reply.slice(0, 240));

  if (!a.approvalId && (/von welchem|vorschlag|würde von|passt das|Absender/i.test(a.reply) || a.statusMessage.includes("Absender"))) {
    const pick = accounts[0]?.emailAddress ? `von ${accounts[0].emailAddress}` : "ja";
    const b = await continueActiveWork({ organizationId: org.id, userRequest: pick });
    console.log("2", b?.statusMessage, "|", b?.orbState, "| approval", Boolean(b?.approvalId));
    console.log((b?.reply ?? "").slice(0, 280));
    // Explicitly do NOT approve / send.
  }

  const open = await loadOpenActiveWork({ organizationId: org.id });
  console.log("open", open?.status ?? "none");
}

main().finally(() => prisma.$disconnect());
