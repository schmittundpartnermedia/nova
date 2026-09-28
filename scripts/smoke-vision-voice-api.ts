import { PrismaClient } from "@prisma/client";

const BASE = process.env.NOVA_BASE_URL ?? "http://127.0.0.1:3100";

async function ask(text: string, inputMode: "text" | "voice" = "voice") {
  const response = await fetch(`${BASE}/api/nova/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      message: text,
      inputMode,
      ...(inputMode === "voice"
        ? {
            voice: {
              startedAt: new Date(Date.now() - 1200).toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1200,
              confidence: 0.92,
              sttEngine: "whisper",
            },
          }
        : {}),
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
  const final = String(done.reply ?? reply).replace(/\n/g, " | ");
  console.log("Q:", text);
  console.log("provider:", done.providerId, "status:", done.statusMessage, "orb:", done.orbState);
  console.log("A:", final.slice(0, 280));
  console.log("---");
  return { done, final };
}

async function main() {
  await ask("Stopp", "text");
  await ask("Lege einen Termin an");
  await ask("morgen um 16 Uhr");
  await ask("NOVA Voice Vision Probe");
  await ask("Was steht an?");
  await ask("Stopp", "text");
  console.log(JSON.stringify({ ok: true, voiceInputMode: true }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
