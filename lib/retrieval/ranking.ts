import type { QueryUnderstanding } from "@/lib/retrieval/query";
import { layerPrior, sourceQualityScore } from "@/lib/retrieval/fusion";

export type RankableHit = {
  id: string;
  organizationId: string;
  layer: string;
  objectType: string;
  objectId: string;
  title: string;
  text: string;
  checksum: string;
  sourceId?: string | null;
  sourceType?: string | null;
  sourceLabel?: string | null;
  epistemicStatus?: string | null;
  projectId?: string | null;
  occurredAt?: Date | null;
  superseded: boolean;
  locationJson?: string | null;
  conversationId?: string | null;
  messageIds?: string | null;
  page?: number | null;
  section?: string | null;
  fusion: number;
  semantic: number;
  fulltext: number;
  entity: number;
  relation: number;
  temporal: number;
  confidence: number;
};

export function temporalScore(hit: RankableHit, query: QueryUnderstanding, now = Date.now()): number {
  const at = hit.occurredAt?.getTime();
  if (query.time.mode === "historical" || query.wantsSupersessionHistory) {
    if (hit.superseded) return 0.95;
    if (!at) return 0.4;
    const age = Math.max(0, now - at) / 86_400_000;
    return Math.min(1, age / 180);
  }
  if (query.time.mode === "current" || query.intent === "price" || query.intent === "decision") {
    if (hit.superseded) return 0.05;
    if (!at) return 0.55;
    const age = Math.max(0, now - at) / 86_400_000;
    return Math.max(0.15, 1 - age / 365);
  }
  if (query.time.month && at) {
    const date = new Date(at);
    return date.getMonth() + 1 === query.time.month ? 1 : 0.2;
  }
  if (!at) return 0.5;
  const age = Math.max(0, now - at) / 86_400_000;
  return Math.max(0.2, 1 - age / 540);
}

export function rerankHits(hits: RankableHit[], query: QueryUnderstanding): RankableHit[] {
  return hits
    .map((hit) => {
      const quality = sourceQualityScore(hit.epistemicStatus, hit.sourceType);
      const temporal = temporalScore(hit, query);
      const layer = layerPrior(hit.layer, query.intent);
      const project = query.entities.some((name) => hit.text.toLowerCase().includes(name.toLowerCase()) || hit.title.toLowerCase().includes(name.toLowerCase()))
        ? 1
        : hit.projectId
          ? 0.7
          : 0.4;
      const currentPenalty = query.time.mode === "current" && hit.superseded ? 0.15 : 1;
      const assistantPenalty = hit.epistemicStatus === "ASSISTANT_SUGGESTED" && (query.intent === "decision" || query.intent === "current") ? 0.45 : 1;
      const score =
        (hit.fusion * 0.42 + hit.semantic * 0.18 + hit.fulltext * 0.12 + hit.entity * 0.1 + hit.relation * 0.08 + quality * 0.1) *
        (0.7 + temporal * 0.2 + layer * 0.1) *
        project *
        currentPenalty *
        assistantPenalty;
      return { ...hit, temporal, confidence: Math.max(0, Math.min(1, score)) };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

export type RetrievalConflict = {
  topic: string;
  values: string[];
  sources: string[];
};

export function detectOpenConflicts(hits: RankableHit[], known: Array<{ topic: string; values: string[] }>): RetrievalConflict[] {
  return known
    .filter((row) => row.values.length > 1)
    .filter((row) => hits.some((hit) => hit.text.toLowerCase().includes(row.topic.toLowerCase()) || row.values.some((value) => hit.text.includes(value))))
    .map((row) => ({
      topic: row.topic,
      values: row.values,
      sources: hits
        .filter((hit) => row.values.some((value) => hit.text.includes(value)))
        .map((hit) => hit.sourceLabel || hit.title)
        .slice(0, 4),
    }));
}
