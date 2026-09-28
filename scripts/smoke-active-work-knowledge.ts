import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { bootstrapAgents } from "@/agents/bootstrap";
import { cancelOpenActiveWorks, loadOpenActiveWork } from "@/services/work/active";
import { startActiveWorkFromIntent, continueActiveWork } from "@/services/work/continue";

bootstrapAgents();
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) throw new Error("no org");
  await cancelOpenActiveWorks(org.id);

  const notePath = path.join(process.cwd(), ".nova-knowledge-smoke.txt");
  writeFileSync(notePath, "Projekt Delta: Preis 880 EUR. Ansprechpartnerin ist Mira Koch.\n", "utf8");

  const ask = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "knowledge",
    goal: "Unterlagen einlesen",
    brief: "Lies bitte die Unterlagen und lerne sie",
    slots: {},
  });
  console.log("1", ask.statusMessage, "|", ask.orbState);
  console.log(ask.reply.slice(0, 200));
  if (!/Pfad fehlt|Pfad/i.test(ask.statusMessage + ask.reply)) {
    throw new Error("expected path ask");
  }

  const open = await loadOpenActiveWork({ organizationId: org.id });
  console.log("open", open?.status, open?.lastQuestion?.slice(0, 80));

  const importStep = await continueActiveWork({
    organizationId: org.id,
    userRequest: notePath,
  });
  console.log("2", importStep?.statusMessage, "|", importStep?.orbState);
  console.log((importStep?.reply ?? "").slice(0, 280));
  if (!importStep?.handled) throw new Error("import step not handled");

  await cancelOpenActiveWorks(org.id);
  const research = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "research",
    goal: "Aktueller Kurs",
    brief: "Was ist der aktuelle Bitcoin-Preis?",
    slots: { query: "Was ist der aktuelle Bitcoin-Preis?" },
  });
  console.log("3", research.statusMessage, "|", research.orbState);
  console.log(research.reply.slice(0, 240));
  if (!research.handled) throw new Error("research not handled");
}

main().finally(() => prisma.$disconnect());
