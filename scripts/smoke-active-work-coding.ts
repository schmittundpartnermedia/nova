import { PrismaClient } from "@prisma/client";
import path from "node:path";
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

  const ask = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "coding",
    goal: "README prüfen",
    brief: "Prüfe kurz den Stand im Repo, nichts committen",
    slots: { task: "Prüfe kurz den Stand im Repo, nichts committen" },
  });
  console.log("1", ask.statusMessage, "|", ask.orbState);
  assert(
    /Pfad fehlt|Angabe fehlt|Projektpfad/i.test(ask.statusMessage + ask.reply),
    "Coding muss nach Pfad fragen",
  );

  const open = await loadOpenActiveWork({ organizationId: org.id });
  assert(open?.status === "clarifying", "Coding ActiveWork clarifying");
  assert(!open?.slots.path, "Pfad noch leer");

  // Slot manuell setzen und prüfen, dass der Pfad gehalten wird — ohne Cursor-Lauf.
  const { updateActiveWorkSlots } = await import("@/services/work/active");
  const updated = await updateActiveWorkSlots({
    organizationId: org.id,
    workId: open!.id,
    slots: { path: path.join(process.cwd()) },
  });
  assert(updated.slots.path === path.join(process.cwd()), "Pfad-Slot muss stehen");
  assert(updated.missingSlots.length === 0, "keine Pflicht-Slots mehr");

  await cancelOpenActiveWorks(org.id);
  console.log(JSON.stringify({ ok: true, codingPathSlot: true, path: updated.slots.path }, null, 2));
}

main().finally(() => prisma.$disconnect());
