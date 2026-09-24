import { z } from "zod";
import { CAPABILITY_IDS } from "@/lib/computer/types";

export const organizationIdSchema = z.string().min(1).max(128);

export const capabilityIdSchema = z.enum(CAPABILITY_IDS);

export const contentSourceSchema = z.enum(["user_intent", "nova_plan", "external_content"]);

export const filesystemActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), path: z.string().min(1), maxEntries: z.number().int().positive().max(500).optional() }),
  z.object({ action: z.literal("stat"), path: z.string().min(1) }),
  z.object({ action: z.literal("read"), path: z.string().min(1), maxBytes: z.number().int().positive().max(2_000_000).optional() }),
  z.object({ action: z.literal("search"), root: z.string().min(1), query: z.string().min(1).max(200), maxResults: z.number().int().positive().max(100).optional() }),
  z.object({ action: z.literal("create"), path: z.string().min(1), content: z.string().max(1_000_000).optional() }),
  z.object({ action: z.literal("write"), path: z.string().min(1), content: z.string().max(1_000_000) }),
  z.object({ action: z.literal("append"), path: z.string().min(1), content: z.string().max(1_000_000) }),
  z.object({ action: z.literal("mkdir"), path: z.string().min(1) }),
  z.object({ action: z.literal("copy"), from: z.string().min(1), to: z.string().min(1) }),
  z.object({ action: z.literal("move"), from: z.string().min(1), to: z.string().min(1) }),
  z.object({ action: z.literal("rename"), from: z.string().min(1), to: z.string().min(1) }),
  z.object({ action: z.literal("delete"), path: z.string().min(1), recursive: z.boolean().optional() }),
]);

export const shellActionSchema = z.object({
  action: z.literal("execute"),
  argv: z.array(z.string().min(1).max(4000)).min(1).max(40),
  cwd: z.string().min(1),
  purpose: z.string().min(1).max(500),
  timeoutMs: z.number().int().positive().max(10 * 60_000).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const processActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), query: z.string().max(200).optional() }),
  z.object({ action: z.literal("inspect"), pid: z.number().int().positive() }),
  z.object({
    action: z.literal("start"),
    argv: z.array(z.string().min(1)).min(1).max(40),
    cwd: z.string().min(1),
    purpose: z.string().min(1).max(500),
    timeoutMs: z.number().int().positive().max(30_000).optional(),
  }),
  z.object({ action: z.literal("stop"), pid: z.number().int().positive(), owned: z.boolean().optional() }),
]);

const cursorTask = z.string().min(1).max(20_000);
const cursorTimeout = z.number().int().positive().max(10 * 60_000).optional();

export const cursorActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("available") }),
  z.object({
    action: z.literal("ask"),
    workspace: z.string().min(1),
    question: cursorTask,
    resumeSessionId: z.string().min(1).max(200).optional(),
    timeoutMs: cursorTimeout,
  }),
  z.object({
    action: z.literal("plan"),
    workspace: z.string().min(1),
    task: cursorTask,
    resumeSessionId: z.string().min(1).max(200).optional(),
    timeoutMs: cursorTimeout,
  }),
  z.object({
    action: z.literal("agent"),
    workspace: z.string().min(1),
    task: cursorTask,
    mode: z.enum(["ask", "plan", "agent"]).default("agent"),
    constraints: z.array(z.string()).max(20).optional(),
    resumeSessionId: z.string().min(1).max(200).optional(),
    timeoutMs: cursorTimeout,
  }),
  z.object({
    action: z.literal("resume"),
    workspace: z.string().min(1),
    sessionId: z.string().min(1).max(200),
    task: cursorTask,
    timeoutMs: cursorTimeout,
  }),
  z.object({
    action: z.literal("createSession"),
    workspace: z.string().min(1),
  }),
  z.object({
    action: z.literal("stop"),
    sessionId: z.string().min(1).max(200).optional(),
  }),
  z.object({ action: z.literal("status"), jobId: z.string().min(1).optional(), sessionId: z.string().min(1).max(200).optional() }),
]);

export const browserLocatorSchema = z.object({
  role: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(500).optional(),
  label: z.string().min(1).max(500).optional(),
  text: z.string().min(1).max(500).optional(),
  testId: z.string().min(1).max(200).optional(),
  placeholder: z.string().min(1).max(500).optional(),
  alt: z.string().min(1).max(500).optional(),
  title: z.string().min(1).max(500).optional(),
  selector: z.string().min(1).max(500).optional(),
  exact: z.boolean().optional(),
});

const browserTargetFields = {
  selector: z.string().min(1).max(500).optional(),
  locator: browserLocatorSchema.optional(),
};

export const browserActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), url: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("navigate"), url: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("back") }),
  z.object({ action: z.literal("forward") }),
  z.object({ action: z.literal("reload") }),
  z.object({ action: z.literal("newTab"), url: z.string().max(2000).optional() }),
  z.object({ action: z.literal("closeTab") }),
  z.object({ action: z.literal("listTabs") }),
  z.object({ action: z.literal("switchTab"), index: z.number().int().nonnegative() }),
  z.object({ action: z.literal("read") }),
  z.object({ action: z.literal("inspect"), maxItems: z.number().int().positive().max(200).optional() }),
  z.object({ action: z.literal("click"), ...browserTargetFields }),
  z.object({ action: z.literal("type"), ...browserTargetFields, text: z.string().max(20_000) }),
  z.object({ action: z.literal("select"), ...browserTargetFields, value: z.string().max(500) }),
  z.object({ action: z.literal("check"), ...browserTargetFields, checked: z.boolean().optional() }),
  z.object({ action: z.literal("scroll"), dy: z.number().optional(), dx: z.number().optional(), ...browserTargetFields }),
  z.object({
    action: z.literal("waitFor"),
    ...browserTargetFields,
    url: z.string().max(2000).optional(),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
  }),
  z.object({ action: z.literal("screenshot"), persist: z.boolean().optional() }),
  z.object({
    action: z.literal("setViewport"),
    width: z.number().int().min(320).max(3840),
    height: z.number().int().min(240).max(2160),
  }),
  z.object({ action: z.literal("download"), ...browserTargetFields, timeoutMs: z.number().int().positive().max(60_000).optional() }),
  z.object({ action: z.literal("upload"), ...browserTargetFields, filePath: z.string().min(1) }),
  z.object({ action: z.literal("submit"), ...browserTargetFields }),
]);

export const applicationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("listInstalled") }),
  z.object({ action: z.literal("listRunning") }),
  z.object({ action: z.literal("launch"), name: z.string().min(1).max(200) }),
  z.object({ action: z.literal("focus"), name: z.string().min(1).max(200) }),
  z.object({ action: z.literal("quit"), name: z.string().min(1).max(200) }),
  z.object({ action: z.literal("windows") }),
]);

export const accessibilityActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("inspect"), app: z.string().max(200).optional(), maxDepth: z.number().int().positive().max(8).optional() }),
  z.object({ action: z.literal("press"), identifier: z.string().min(1).max(500), app: z.string().max(200).optional() }),
  z.object({ action: z.literal("focus"), identifier: z.string().min(1).max(500), app: z.string().max(200).optional() }),
  z.object({ action: z.literal("setValue"), identifier: z.string().min(1).max(500), value: z.string().max(20_000), app: z.string().max(200).optional() }),
  z.object({ action: z.literal("select"), identifier: z.string().min(1).max(500), app: z.string().max(200).optional() }),
  z.object({ action: z.literal("expand"), identifier: z.string().min(1).max(500), app: z.string().max(200).optional() }),
  z.object({ action: z.literal("collapse"), identifier: z.string().min(1).max(500), app: z.string().max(200).optional() }),
  z.object({ action: z.literal("scroll"), identifier: z.string().min(1).max(500), app: z.string().max(200).optional() }),
]);

export const screenActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("capture"), persist: z.boolean().optional() }),
  z.object({ action: z.literal("inspect") }),
]);

export const computerActionEnvelopeSchema = z.object({
  organizationId: organizationIdSchema,
  jobId: z.string().min(1).max(128).optional(),
  stepId: z.string().min(1).max(128).optional(),
  requestId: z.string().min(1).max(128),
    timeoutMs: z.number().int().positive().max(10 * 60_000).optional(),
  approvalToken: z.string().min(1).max(256).optional(),
  userCommissioned: z.boolean().optional(),
  source: contentSourceSchema.default("nova_plan"),
  tool: z.enum(["browser", "filesystem", "shell", "cursor", "application", "process", "screen", "accessibility"]),
  payload: z.unknown(),
});

export type ComputerActionEnvelope = z.infer<typeof computerActionEnvelopeSchema>;
export type FilesystemAction = z.infer<typeof filesystemActionSchema>;
export type ShellAction = z.infer<typeof shellActionSchema>;
export type ProcessAction = z.infer<typeof processActionSchema>;
export type CursorAction = z.infer<typeof cursorActionSchema>;
export type BrowserAction = z.infer<typeof browserActionSchema>;
export type ApplicationAction = z.infer<typeof applicationActionSchema>;
export type AccessibilityAction = z.infer<typeof accessibilityActionSchema>;
export type ScreenAction = z.infer<typeof screenActionSchema>;
