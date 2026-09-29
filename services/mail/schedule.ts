import { enqueueWorkItem } from "@/services/worker/queue";
import { assertOrganizationId } from "@/services/tenant";

/** Eine Mail pro Work-Item, zeitversetzt über runAt (Akquise / Kampagnen). */
export async function scheduleMailSend(input: {
  organizationId: string;
  entwurfId: string;
  jobId?: string;
  runAt: Date;
  delayMs?: number;
}) {
  assertOrganizationId(input.organizationId);
  const runAt = input.delayMs ? new Date(input.runAt.getTime() + input.delayMs) : input.runAt;
  return enqueueWorkItem({
    organizationId: input.organizationId,
    jobId: input.jobId,
    kind: "mail.send",
    idempotencyKey: `mail.send:${input.entwurfId}`,
    payload: { entwurfId: input.entwurfId },
    runAt,
    maxAttempts: 5,
  });
}

export async function scheduleMailSendBatch(input: {
  organizationId: string;
  entwurfIds: string[];
  jobId?: string;
  startAt?: Date;
  intervalMs?: number;
}) {
  const start = input.startAt ?? new Date();
  const interval = input.intervalMs ?? 5 * 60_000;
  const ids: string[] = [];
  for (let i = 0; i < input.entwurfIds.length; i += 1) {
    const entwurfId = input.entwurfIds[i]!;
    const item = await enqueueWorkItem({
      organizationId: input.organizationId,
      jobId: input.jobId,
      kind: "mail.send",
      idempotencyKey: `mail.send:${entwurfId}:${start.toISOString()}:${i}`,
      payload: { entwurfId },
      runAt: new Date(start.getTime() + i * interval),
      maxAttempts: 5,
    });
    ids.push(item.id);
  }
  return ids;
}
