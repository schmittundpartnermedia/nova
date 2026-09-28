import fs from "node:fs";
import path from "node:path";
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
  const org = await prisma.organization.findFirst({ where: { slug: "joachim" } });
  if (!org) throw new Error("no org");
  await cancelOpenActiveWorks(org.id);

  const sandbox = path.join(process.cwd(), ".nova", "coding-e2e-sandbox");
  fs.mkdirSync(sandbox, { recursive: true });
  fs.writeFileSync(path.join(sandbox, "README.md"), "# NOVA Coding E2E\n", "utf8");
  const helloPath = path.join(sandbox, "hello-nova.txt");
  if (fs.existsSync(helloPath)) fs.unlinkSync(helloPath);
  console.log("sandbox", sandbox);

  const ask = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "coding",
    goal: "Datei anlegen",
    brief: "Lege eine Datei hello-nova.txt mit dem Inhalt hello-nova an. Nichts committen, nichts pushen.",
    slots: { task: "Lege eine Datei hello-nova.txt mit dem Inhalt hello-nova an. Nichts committen, nichts pushen." },
  });
  console.log("1", ask.statusMessage, "|", ask.orbState);
  assert(/Pfad|Angabe fehlt|Projektpfad/i.test(ask.statusMessage + ask.reply), "muss Pfad fragen");

  const run = await continueActiveWork({
    organizationId: org.id,
    userRequest: sandbox,
  });
  console.log("2", run?.statusMessage, "|", run?.orbState);
  console.log((run?.reply ?? "").slice(0, 400));
  assert(run?.handled, "Coding-Lauf muss gehandelt werden");

  const created = fs.existsSync(helloPath);
  console.log("hello exists", created, created ? fs.readFileSync(helloPath, "utf8").slice(0, 80) : "");

  // Auch ohne Datei: ActiveWork darf nicht offen hängen (done/failed/cancelled).
  const open = await loadOpenActiveWork({ organizationId: org.id });
  console.log("open", open?.status ?? "none");
  assert(!open || open.status === "clarifying", "nach Lauf kein offenes executing Work");

  console.log(
    JSON.stringify(
      {
        ok: true,
        sandbox,
        fileCreated: created,
        statusMessage: run?.statusMessage,
        orbState: run?.orbState,
      },
      null,
      2,
    ),
  );
}

main().finally(() => prisma.$disconnect());
