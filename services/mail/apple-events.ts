import { ensureNativeHelper, invokeNativeHelper } from "@/lib/computer/capabilities";
import { assertMailScriptSafe, type MailAutomationState } from "@/lib/mail/apple";

let cached: { at: number; state: MailAutomationState } | null = null;

export function clearMailAutomationCache(): void {
  cached = null;
}

export async function openMailIfClosed(): Promise<void> {
  if (process.platform !== "darwin") return;
  clearMailAutomationCache();
  const state = await readMailAutomationState();
  if (state !== "unavailable") return;
  const launched = await invokeNativeHelper({ cmd: "app.launch", app: "com.apple.mail" }, 12_000);
  if (!launched.ok) return;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    clearMailAutomationCache();
    const next = await readMailAutomationState();
    if (next !== "unavailable") return;
  }
}

export async function readMailAutomationState(): Promise<MailAutomationState> {
  if (cached && Date.now() - cached.at < 15_000) return cached.state;
  if (process.platform !== "darwin") return "unavailable";
  const helper = await ensureNativeHelper();
  if (!helper.ok) return "unavailable";
  const result = await invokeNativeHelper({ cmd: "automation.mail" }, 12_000);
  const state = result.data?.state;
  const resolved: MailAutomationState =
    state === "granted" || state === "denied" || state === "required" || state === "unavailable" ? state : "unavailable";
  cached = { at: Date.now(), state: resolved };
  return resolved;
}

export async function runMailAppleScript(
  source: string,
  timeoutMs = 20_000,
): Promise<{ ok: true; output: string } | { ok: false; permission: boolean; error: string }> {
  const safe = assertMailScriptSafe(source);
  if (!safe.ok) return { ok: false, permission: false, error: safe.reason };
  if (process.platform !== "darwin") return { ok: false, permission: false, error: "PROVIDER_UNAVAILABLE" };
  const helper = await ensureNativeHelper();
  if (!helper.ok) return { ok: false, permission: false, error: helper.reason };
  const result = await invokeNativeHelper({ cmd: "applescript.run", script: source }, timeoutMs);
  if (result.permission === "automation" || result.error === "PERMISSION_REQUIRED") {
    clearMailAutomationCache();
    return { ok: false, permission: true, error: "AUTOMATION_PERMISSION_REQUIRED" };
  }
  if (!result.ok) {
    const error = typeof result.error === "string" && result.error ? result.error : "APPLE_EVENT_FAILED";
    return { ok: false, permission: false, error };
  }
  const data = result.data ?? {};
  const output = typeof data.output === "string" ? data.output : "";
  return { ok: true, output };
}
