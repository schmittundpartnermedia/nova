import { PrismaClient } from "@prisma/client";
import { startActiveWorkFromIntent, continueActiveWork } from "@/services/work/continue";
import { loadOpenActiveWork, cancelOpenActiveWorks } from "@/services/work/active";

const prisma = new PrismaClient();
async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error("no org");
  await cancelOpenActiveWorks(org.id);
  const a = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "calendar",
    goal: "Termin anlegen",
    brief: "Leg einen Termin an",
    slots: {},
  });
  console.log("1", a.statusMessage, "|", a.reply.slice(0, 90));
  const b = await continueActiveWork({ organizationId: org.id, userRequest: "morgen um 15 Uhr" });
  console.log("2", b?.statusMessage, "|", b?.reply.slice(0, 100));
  const c = await continueActiveWork({ organizationId: org.id, userRequest: "Call mit Anna" });
  console.log("3", c?.statusMessage, "|", c?.orbState, "|", c?.reply.slice(0, 140));
  const open = await loadOpenActiveWork({ organizationId: org.id });
  console.log("open", open?.status ?? "none", open?.evidence?.slice(0, 100) ?? "");
}
main().finally(() => prisma.$disconnect());
