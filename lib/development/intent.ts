export type DevelopmentIntent =
  | { kind: "none" }
  | { kind: "commission"; statusMessage: string }
  | { kind: "status"; statusMessage: string };

const STATUS_RE =
  /was baut cursor|woran (?:arbeitet|baut) cursor|woran cursor(?: gerade)?|wie weit ist|warum ist das noch nicht fertig|was ist fehlgeschlagen|was wurde ge(?:ä|ae)?ndert|status der entwicklung|entwicklungsauftr/i;

const COMMISSION_RE =
  /ich möchte, dass du|ich moechte, dass du|ich will, dass du|entwickle dir|neue fähigkeit|neue faehigkeit|künftig .{0,80}(kannst|können|sollst)|kuenftig .{0,80}(kannst|können|sollst)|ab sofort .{0,80}(kannst|können|sollst)/i;

export function detectDevelopmentIntent(userRequest: string): DevelopmentIntent {
  const text = userRequest.trim();
  if (!text) return { kind: "none" };
  // Commission first: Wunschtexte können Status-Phrasen enthalten, ohne eine Statusfrage zu sein.
  if (COMMISSION_RE.test(text)) {
    return { kind: "commission", statusMessage: "Ich mache daraus einen Entwicklungsauftrag." };
  }
  if (STATUS_RE.test(text)) {
    return { kind: "status", statusMessage: "Ich schaue auf den Entwicklungsauftrag." };
  }
  return { kind: "none" };
}
