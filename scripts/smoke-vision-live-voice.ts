/**
 * Live-Voice-Pfad ohne Hardware-Mic:
 * - Session-Maschine (verify)
 * - Transcribe/Speech Endpoints
 * - ActiveWork über inputMode=voice
 */
import { runVoiceSessionChecks } from "@/scripts/verify-voice-session";
import { prepareTextForSpeech } from "@/services/voice/prepare-text";

const BASE = process.env.NOVA_BASE_URL ?? "http://127.0.0.1:3100";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function probe(pathName: string) {
  const response = await fetch(`${BASE}${pathName}`, { method: "GET", cache: "no-store" });
  return { ok: response.ok, status: response.status };
}

async function askVoice(text: string) {
  const response = await fetch(`${BASE}/api/nova/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      message: text,
      inputMode: "voice",
      voice: {
        startedAt: new Date(Date.now() - 900).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 900,
        confidence: 0.9,
        sttEngine: "whisper",
      },
    }),
  });
  const body = await response.text();
  let reply = "";
  let done: Record<string, unknown> = {};
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ") || line.trim() === "data: [DONE]") continue;
    const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
    if (payload.type === "delta") reply += String(payload.delta ?? "");
    if (payload.type === "done") done = payload;
  }
  const final = String(done.reply ?? reply);
  const spoken = prepareTextForSpeech(final);
  console.log("Q:", text);
  console.log("provider:", done.providerId, "status:", done.statusMessage);
  console.log("spoken:", spoken.slice(0, 160));
  console.log("---");
  return { done, final, spoken };
}

async function main() {
  const session = await runVoiceSessionChecks();
  assert(session.ok, "Voice-Session muss grün sein");

  const transcribe = await probe("/api/nova/transcribe");
  const speech = await probe("/api/nova/speech");
  console.log("endpoints", { transcribe, speech });
  assert(transcribe.ok || transcribe.status < 500, "transcribe endpoint erreichbar");
  assert(speech.ok || speech.status < 500, "speech endpoint erreichbar");

  await askVoice("Stopp");
  const turn = await askVoice("Was steht an?");
  assert(turn.spoken.trim().length > 0, "Antwort muss sprechbar sein");
  assert(!/Erledigt und geprüft/i.test(turn.spoken) || /Aufgabe|Termin|Mail|Nichts/i.test(turn.spoken), "keine leere Erledigt-Behauptung");

  console.log(JSON.stringify({ ok: true, sessionTurns: session.turns.length, liveMicHardware: "manual" }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
