import { closeLiveSttSession, createLiveSttSession, getLiveSttSession } from "@/lib/voice/live-stt-registry";
import { hasOpenAIApiKey } from "@/lib/secrets";
import type { LiveSttEvent } from "@/features/voice/live-stt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!hasOpenAIApiKey()) {
    return Response.json({ ok: false, error: "Spracheingabe momentan nicht verfügbar." }, { status: 503 });
  }

  let body: { action?: string; sessionId?: string; pcm?: string; paused?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "Ungültige Anfrage." }, { status: 400 });
  }

  const action = body.action ?? "";
  if (action === "start") {
    try {
      const session = await createLiveSttSession();
      return Response.json({ ok: true, sessionId: session.id });
    } catch {
      return Response.json({ ok: false, error: "Spracheingabe momentan nicht verfügbar." }, { status: 503 });
    }
  }

  const session = body.sessionId ? getLiveSttSession(body.sessionId) : null;
  if (!session) {
    return Response.json({ ok: false, error: "Sitzung nicht gefunden." }, { status: 404 });
  }

  if (action === "audio") {
    if (typeof body.pcm === "string" && body.pcm.length > 0) session.sendPcm(body.pcm);
    return Response.json({ ok: true });
  }
  if (action === "pause") {
    session.setPaused(true);
    return Response.json({ ok: true });
  }
  if (action === "resume") {
    session.setPaused(false);
    return Response.json({ ok: true });
  }
  if (action === "stop") {
    closeLiveSttSession(session.id);
    return Response.json({ ok: true });
  }

  return Response.json({ ok: false, error: "Ungültige Anfrage." }, { status: 400 });
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
  const session = getLiveSttSession(sessionId);
  if (!session) {
    return Response.json({ ok: false, error: "Sitzung nicht gefunden." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: LiveSttEvent | { type: "ready" }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      send({ type: "ready" });
      unsubscribe = session.subscribe((event) => send(event));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // stream closed
        }
      }, 15000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
