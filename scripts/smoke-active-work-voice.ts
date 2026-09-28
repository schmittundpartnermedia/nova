import { PrismaClient } from "@prisma/client";
import { bootstrapAgents } from "@/agents/bootstrap";
import { cancelOpenActiveWorks } from "@/services/work/active";
import { startActiveWorkFromIntent, continueActiveWork } from "@/services/work/continue";
import { prepareTextForSpeech } from "@/services/voice/prepare-text";
import { runVoiceSessionChecks } from "@/scripts/verify-voice-session";

bootstrapAgents();
const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const session = await runVoiceSessionChecks();
  assert(session.ok, "Voice-Session-Maschine muss grün sein");
  console.log("session", session.engine, session.turns.length, "turns");

  const org = await prisma.organization.findFirst();
  if (!org) throw new Error("no org");
  await cancelOpenActiveWorks(org.id);

  // Simuliert Mic→Transkript→ActiveWork: kurze Spoken Turns ohne Klick.
  const turn1 = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "calendar",
    goal: "Termin anlegen",
    brief: "Lege einen Termin an",
    slots: {},
  });
  console.log("voice-1", turn1.statusMessage, "|", turn1.orbState);
  const spoken1 = prepareTextForSpeech(turn1.reply);
  assert(spoken1.trim().length > 0, "Klärfrage muss sprechbar sein");
  assert(!/Erledigt und geprüft/i.test(spoken1), "Klärfrage darf kein Erledigt behaupten");
  assert(/wann|titel|termin/i.test(spoken1), `Erwartete Termin-Klärfrage, war: ${spoken1.slice(0, 120)}`);

  const turn2 = await continueActiveWork({
    organizationId: org.id,
    userRequest: "morgen um 15 Uhr",
  });
  assert(turn2?.handled, "zweite Stimme-Antwort muss ActiveWork fortsetzen");
  const spoken2 = prepareTextForSpeech(turn2!.reply);
  assert(!/Erledigt und geprüft/i.test(spoken2), "Noch keine Erledigt-Behauptung vor Evidence");
  console.log("voice-2", turn2?.statusMessage, "|", spoken2.slice(0, 120));

  const turn3 = await continueActiveWork({
    organizationId: org.id,
    userRequest: "NOVA Stimme Kettenprobe",
  });
  assert(turn3?.handled, "dritte Stimme-Antwort muss ActiveWork fortsetzen");
  console.log("voice-3", turn3?.statusMessage, "|", (turn3?.reply ?? "").slice(0, 160));

  await cancelOpenActiveWorks(org.id);
  const watch = await startActiveWorkFromIntent({
    organizationId: org.id,
    domain: "watch",
    goal: "Was steht an",
    brief: "Was steht an?",
    slots: {},
  });
  assert(watch.handled && watch.orbState === "DONE", "Watch-Scan muss ActiveWork abschließen");
  const spokenWatch = prepareTextForSpeech(watch.reply);
  assert(spokenWatch.trim().length > 0, "Watch-Antwort muss sprechbar sein");
  console.log("watch", watch.statusMessage, "|", spokenWatch.slice(0, 160));

  console.log(JSON.stringify({ ok: true, sessionTurns: session.turns.length, voiceChain: true }, null, 2));
}

main().finally(() => prisma.$disconnect());
