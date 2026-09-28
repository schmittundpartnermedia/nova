import { PrismaClient } from "@prisma/client";
import { bootstrapAgents } from "@/agents/bootstrap";
import { runMaster } from "@/agents/master";
import { cancelOpenActiveWorks } from "@/services/work/active";

bootstrapAgents();
const prisma = new PrismaClient();

async function main() {
  const org =
    (await prisma.organization.findFirst({ where: { slug: "joachim" } })) ??
    (await prisma.organization.findFirst());
  if (!org) throw new Error("no org");
  await cancelOpenActiveWorks(org.id);

  const r1 = await runMaster({ organizationId: org.id, userRequest: "Lege einen Termin an" });
  console.log("1", r1.providerId, r1.statusMessage, (r1.reply ?? "").slice(0, 120));
  const r2 = await runMaster({ organizationId: org.id, userRequest: "übermorgen um 11 Uhr" });
  console.log("2", r2.providerId, r2.statusMessage, (r2.reply ?? "").slice(0, 120));
  const r3 = await runMaster({ organizationId: org.id, userRequest: "NOVA Vision Abnahme" });
  console.log("3", r3.providerId, r3.statusMessage, (r3.reply ?? "").slice(0, 160));
  const r4 = await runMaster({ organizationId: org.id, userRequest: "Stopp" });
  console.log("4", r4.statusMessage, (r4.reply ?? "").slice(0, 120));
  const r5 = await runMaster({ organizationId: org.id, userRequest: "Was steht an?" });
  console.log("5", r5.providerId, r5.statusMessage, (r5.reply ?? "").slice(0, 160));
}

main().finally(() => prisma.$disconnect());
