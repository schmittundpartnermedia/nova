export function reciprocalRankFusion(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return scores;
}

export function minMax(values: number[]): (value: number) => number {
  const finite = values.filter((value) => Number.isFinite(value));
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  const span = max - min || 1;
  return (value: number) => (value - min) / span;
}

export function bm25Score(queryTokens: string[], document: string): number {
  const terms = document.toLowerCase().split(/[^a-z0-9äöüß]+/i).filter((token) => token.length > 1);
  if (!terms.length || !queryTokens.length) return 0;
  const freq = new Map<string, number>();
  for (const term of terms) freq.set(term, (freq.get(term) ?? 0) + 1);
  const avg = 40;
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  for (const token of queryTokens) {
    const tf = freq.get(token) ?? 0;
    if (!tf) continue;
    const idf = Math.log(1 + (terms.length + 1) / (tf + 0.5));
    const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * (terms.length / avg)));
    score += idf * norm;
  }
  return score;
}

export const SOURCE_QUALITY: Record<string, number> = {
  TOOL_VERIFIED: 1,
  SYSTEM_OBSERVED: 0.9,
  USER_CONFIRMED: 0.88,
  JOINTLY_DECIDED: 0.86,
  USER_STATED: 0.72,
  ASSISTANT_SUGGESTED: 0.32,
  UNCERTAIN: 0.22,
};

export function sourceQualityScore(status?: string | null, sourceType?: string | null): number {
  if (status && SOURCE_QUALITY[status] != null) return SOURCE_QUALITY[status];
  if (sourceType === "pdf" || sourceType === "docx") return 0.84;
  if (sourceType === "xlsx" || sourceType === "csv" || sourceType === "json") return 0.8;
  if (sourceType === "chatgpt" || sourceType === "chat") return 0.62;
  return 0.5;
}

export function layerPrior(layer: string, intent: string): number {
  if (intent === "source" || intent === "historical") {
    if (layer === "archive") return 0.8;
    if (layer === "knowledge") return 0.9;
    return 0.85;
  }
  if (layer === "memory") return 1;
  if (layer === "knowledge") return 0.92;
  return 0.48;
}
