import { redactUnknown } from "@/lib/computer/redaction";

export function logDesktop(event: string, fields: Record<string, unknown> = {}): void {
  const payload = redactUnknown({
    ts: new Date().toISOString(),
    service: "nova-desktop",
    event,
    ...fields,
  });
  console.log(JSON.stringify(payload));
}
