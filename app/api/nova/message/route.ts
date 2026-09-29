import { getCurrentTenant } from "@/services/tenant";
import { failJobsLeftByFailedRequest } from "@/services/jobs/recover";
import { runMaster, type MasterEvent } from "@/agents/master";
import { getOrCreateActiveConversation, appendMessage } from "@/services/conversation";
import { recordConversationTurn } from "@/services/archive";
import { publicErrorMessage, redactSecrets } from "@/lib/secrets";
import type { ConversationInputMode } from "@/types/conversation";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const voiceMetaSchema = z.object({
  startedAt: z.string().min(1).max(64).optional(),
  endedAt: z.string().min(1).max(64).optional(),
  durationMs: z.number().nonnegative().max(60 * 60 * 1000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  sttEngine: z.string().min(1).max(64).optional(),
});

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  inputMode: z.enum(["text", "voice", "system", "external"]).default("text"),
  voice: voiceMetaSchema.optional(),
});

function encodeEvent(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  let parsed: {
    message: string;
    inputMode: ConversationInputMode;
    voice?: {
      startedAt?: string;
      endedAt?: string;
      durationMs?: number;
      confidence?: number;
      sttEngine?: string;
    };
  };
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
        const voiceMeta = parsed.inputMode === "voice" ? parsed.voice : undefined;
        const userMessage = await appendMessage({
          organizationId: tenant.organizationId,
          conversationId: conversation.id,
          role: "user",
          content: redactSecrets(parsed.message),
          inputMode: parsed.inputMode,
          visible: true,
          metadata: {
            channel: "nova-ui",
            ...(voiceMeta
              ? {
                  startedAt: voiceMeta.startedAt,
                  endedAt: voiceMeta.endedAt,
                  durationMs: voiceMeta.durationMs,
                  confidence: voiceMeta.confidence,
                  sttEngine: voiceMeta.sttEngine,
                }
              : {}),
          },
        });

        let assistantMessageId: string | undefined;
        let resultReply = "";
        let resultPayload: Record<string, unknown> | null = null;

        const startedAt = new Date();
        try {
          const result = await runMaster({
            organizationId: tenant.organizationId,
            userRequest: parsed.message,
            conversationId: conversation.id,
            sourceMessageId: userMessage.id,
            signal: request.signal,
            onEvent: (event: MasterEvent) => {
              send(event);
            },
          });
          resultReply = result.reply;
          resultPayload = {
            type: "done",
            ok: result.orbState !== "ERROR",
            organizationId: tenant.organizationId,
            jobId: result.jobId,
            status: result.status,
            orbState: result.orbState,
            statusMessage: result.statusMessage,
            reply: result.reply,
            providerMode: result.providerMode,
            providerId: result.providerId,
            model: result.model,
          };
        } catch (error) {
          await failJobsLeftByFailedRequest(tenant.organizationId, startedAt).catch(() => undefined);
          resultReply = publicErrorMessage(error);
          send({
            type: "error",
            ok: false,
            orbState: "ERROR",
            providerMode: "error",
            statusMessage: "Etwas ist schiefgelaufen.",
            error: resultReply,
          });
        }

        if (resultReply) {
          const assistantMessage = await appendMessage({
            organizationId: tenant.organizationId,
            conversationId: conversation.id,
            role: "assistant",
            content: resultReply,
            inputMode: parsed.inputMode,
            status: resultPayload ? "final" : "error",
            visible: true,
            metadata: { channel: "nova-ui" },
          });
          assistantMessageId = assistantMessage.id;
        }

        await recordConversationTurn({
          organizationId: tenant.organizationId,
          conversationId: conversation.id,
          userMessageId: userMessage.id,
          assistantMessageId,
          inputMode: parsed.inputMode,
          userContent: userMessage.content,
          assistantContent: resultReply || undefined,
        });

        if (resultPayload) {
          send({
            ...resultPayload,
            conversationId: conversation.id,
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessageId ?? null,
            stored: true,
            visible: true,
            inputMode: parsed.inputMode,
          });
        }
      } catch (error) {
        send({
          type: "error",
          ok: false,
          orbState: "ERROR",
          providerMode: "error",
          statusMessage: "Etwas ist schiefgelaufen.",
          error: publicErrorMessage(error),
          stored: false,
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
