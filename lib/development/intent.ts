export type DevelopmentIntent =
  | { kind: "none" }
  | { kind: "commission"; statusMessage: string }
  | { kind: "status"; statusMessage: string };

const STATUS_RE =
  /was baut cursor|wie weit ist|warum ist das noch nicht fertig|was ist fehlgeschlagen|was wurde geändert|was wurde geaendert|status der entwicklung/i;

const COMMISSION_RE =
  /ich möchte, dass du|ich moechte, dass du|ich will, dass du|entwickle dir|neue fähigkeit|neue faehigkeit|künftig .{0,80}(kannst|können|sollst)|kuenftig .{0,80}(kannst|können|sollst)|ab sofort .{0,80}(kannst|können|sollst)/i;

export function detectDevelopmentIntent(userRequest: string): DevelopmentIntent {
  const text = userRequest.trim();
  if (!text) return { kind: "none" };
  if (STATUS_RE.test(text)) {
    return { kind: "status", statusMessage: "Ich schaue auf den Entwicklungsauftrag." };
  }
  if (COMMISSION_RE.test(text)) {
    return { kind: "commission", statusMessage: "Ich mache daraus einen Entwicklungsauftrag." };
  }
  return { kind: "none" };
}
