import { getCurrentTenant } from "@/services/tenant";
import { runMaster, type MasterEvent } from "@/agents/master";
import { getOrCreateActiveConversation, appendMessage } from "@/services/conversation";
import { publicErrorMessage, redactSecrets } from "@/lib/secrets";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
});

function encodeEvent(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  let parsed: { message: string };
  try {
    const json = await request.json();
    parsed = bodySchema.parse(json);
  } catch {
    return Response.json(
      { ok: false, orbState: "ERROR", statusMessage: "Ungültige Anfrage.", providerMode: "error" },
      { status: 400 },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encodeEvent(payload));
      };
      try {
        const tenant = await getCurrentTenant();
        const conversation = await getOrCreateActiveConversation(tenant.organizationId);
        await appendMessage({
          organizationId: tenant.organizationId,
          conversationId: conversation.id,
          role: "user",
          content: redactSecrets(parsed.message),
        });

        const result = await runMaster({
          organizationId: tenant.organizationId,
          userRequest: parsed.message,
          conversationId: conversation.id,
          onEvent: (event: MasterEvent) => {
            send(event);
          },
        });

        if (result.reply) {
          await appendMessage({
            organizationId: tenant.organizationId,
            conversationId: conversation.id,
            role: "assistant",
            content: result.reply,
          });
        }

        send({
          type: "done",
          ok: result.orbState !== "ERROR",
          organizationId: tenant.organizationId,
          jobId: result.jobId,
          status: result.status,
          orbState: result.orbState,
          statusMessage: result.statusMessage,
          reply: result.reply,
          approvalId: result.approvalId,
          mock: result.mock,
          providerMode: result.providerMode,
          providerId: result.providerId,
          model: result.model,
        });
      } catch (error) {
        send({
          type: "error",
          ok: false,
          orbState: "ERROR",
          providerMode: "error",
          statusMessage: "Etwas ist schiefgelaufen.",
          error: publicErrorMessage(error),
        });
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
