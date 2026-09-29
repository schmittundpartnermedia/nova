import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { HEAD_MODEL } from "@/providers/ai/models";
import { OpenAIProvider } from "@/providers/ai/openai";
import type { HeadProvider } from "@/types/ai";

const openai = new OpenAIProvider();

/**
 * Der Kopf spricht immer mit OpenAI. Kein Ersatzanbieter: Ist die API nicht erreichbar,
 * scheitert die Anfrage sichtbar statt mit erfundenen Antworten weiterzulaufen.
 */
export async function resolveHead(organizationId: string): Promise<{ provider: HeadProvider; model: string }> {
  assertOrganizationId(organizationId);
  const config = await prisma.aiProviderConfig.findUnique({
    where: { organizationId_role: { organizationId, role: "master" } },
  });
  const model = config?.model?.trim() || HEAD_MODEL;
  return { provider: openai, model };
}

export function headProvider(): HeadProvider {
  return openai;
}
