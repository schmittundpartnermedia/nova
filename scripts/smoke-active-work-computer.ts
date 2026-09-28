import { bootstrapAgents } from "@/agents/bootstrap";
import { PrismaClient } from "@prisma/client";
import { cancelOpenActiveWorks, loadOpenActiveWork } from "@/services/work/active";
import { startActiveWorkFromIntent, continueActiveWork } from "@/services/work/continue";
import { planComputerTask } from "@/agents/computer/planner";

bootstrapAgents();
const prisma = new PrismaClient();

async function main() {
  // Planner unit: generic with app should open
  const steps = planComputerTask({
    kind: "generic",
    userRequest: "Öffne TextEdit auf meinem Mac",
    workspace: process.cwd(),
  });
  console.log(
    "planner generic→open",
    steps.length > 0 && steps.some((s) => (s.payload as { action?: string }).action === "launch"),
    steps.map((s) => s.purpose).join(" | "),
  );

  const org = await prisma.organization.findFirst();
  if (!org) throw new Error("no org");
  await cancelOpenActiveWorks(org.id);

  const a = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "computer",
    goal: "TextEdit bedienen",
    brief: "Ich will etwas in TextEdit machen",
    slots: { goal: "Ich will etwas in TextEdit machen" },
  });
  console.log("1", a.statusMessage, "|", a.orbState);
  console.log(a.reply.slice(0, 180));

  const b = await continueActiveWork({
    organizationId: org.id,
    userRequest: "öffne TextEdit",
  });
  console.log("2", b?.statusMessage, "|", b?.orbState);
  console.log((b?.reply ?? "").slice(0, 280));

  const open = await loadOpenActiveWork({ organizationId: org.id });
  console.log("open", open?.status ?? "none", "lastStep", open?.slots.lastStep ?? "-");

  const c = await continueActiveWork({
    organizationId: org.id,
    userRequest: "fertig",
  });
  console.log("3", c?.statusMessage, "|", c?.orbState);
  console.log("open after", (await loadOpenActiveWork({ organizationId: org.id }))?.status ?? "none");

  // Zweite Kette: Screenshot als Alltagsschritt
  await cancelOpenActiveWorks(org.id);
  const shot = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "computer",
    goal: "Screenshot",
    brief: "Mach einen Screenshot vom Desktop",
    slots: { goal: "Mach einen Screenshot vom Desktop" },
  });
  console.log("4", shot.statusMessage, "|", shot.orbState);
  console.log(shot.reply.slice(0, 200));
  const shotDone = await continueActiveWork({
    organizationId: org.id,
    userRequest: "fertig",
  });
  console.log("5", shotDone?.statusMessage, "|", shotDone?.orbState);
  console.log("open final", (await loadOpenActiveWork({ organizationId: org.id }))?.status ?? "none");
}

main().finally(() => prisma.$disconnect());
