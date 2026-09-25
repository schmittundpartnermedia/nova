import type { QueryUnderstanding } from "@/lib/retrieval/query";
import type { RankableHit, RetrievalConflict } from "@/lib/retrieval/ranking";

const BUDGET = 6500;

export type BuiltContext = {
  promptBlock: string;
  facts: string[];
  currentDecisions: string[];
  historicalDecisions: string[];
  entities: string[];
  relations: string[];
  tasks: string[];
  conflicts: string[];
  sources: string[];
};

function line(hit: RankableHit): string {
  const when = hit.occurredAt ? hit.occurredAt.toISOString().slice(0, 10) : "";
  const where = [hit.sourceLabel, hit.page ? `S.${hit.page}` : "", hit.section ?? ""].filter(Boolean).join(", ");
  return `- ${hit.text.slice(0, 320)}${when ? ` (${when})` : ""}${where ? ` Quelle: ${where}` : ""}`;
}

function dedupe(hits: RankableHit[]): RankableHit[] {
  const seen = new Set<string>();
  const out: RankableHit[] = [];
  for (const hit of hits) {
    const key = hit.checksum || hit.text.slice(0, 180);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

export function buildStructuredContext(input: {
  query: QueryUnderstanding;
  hits: RankableHit[];
  conflicts: RetrievalConflict[];
  relations: string[];
}): BuiltContext {
  const hits = dedupe(input.hits).filter((hit) => hit.organizationId.length > 0);
  const decisions = hits.filter((hit) => hit.objectType === "decision" || /entscheid/i.test(hit.title + hit.text));
  const currentDecisions = decisions.filter((hit) => !hit.superseded).slice(0, 4).map(line);
  const historicalDecisions = input.query.wantsSupersessionHistory
    ? decisions.filter((hit) => hit.superseded).slice(0, 4).map(line)
    : [];
  const tasks = hits.filter((hit) => hit.objectType === "task" || /aufgabe|frist|deadline|commitment/i.test(hit.title)).slice(0, 4).map(line);
  const entities = [...new Set(input.query.entities)].slice(0, 6).map((name) => `- ${name}`);
  const facts = hits
    .filter((hit) => !decisions.includes(hit) && hit.objectType !== "task")
    .slice(0, 6)
    .map(line);
  const relations = input.relations.slice(0, 6).map((item) => `- ${item}`);
  const conflicts = input.conflicts.slice(0, 4).map((item) => `- ${item.topic}: ${item.values.join(" vs. ")} (${item.sources.join("; ") || "Quellen im Kontext"})`);
  const sources = hits.slice(0, 8).map((hit) => {
    const loc = [hit.sourceLabel || hit.sourceType || hit.layer, hit.page ? `Seite ${hit.page}` : "", hit.section ?? "", hit.occurredAt ? hit.occurredAt.toISOString().slice(0, 10) : ""]
      .filter(Boolean)
      .join(", ");
    return `- ${hit.title}: ${loc}; Status ${hit.epistemicStatus ?? "unklar"}; Vertrauen ${hit.confidence.toFixed(2)}`;
  });

  const sections: string[] = [];
  if (facts.length) sections.push(`Relevant Facts:\n${facts.join("\n")}`);
  if (currentDecisions.length) sections.push(`Current Decisions:\n${currentDecisions.join("\n")}`);
  if (historicalDecisions.length) sections.push(`Historical Decisions:\n${historicalDecisions.join("\n")}`);
  if (entities.length) sections.push(`Entities:\n${entities.join("\n")}`);
  if (relations.length) sections.push(`Relations:\n${relations.join("\n")}`);
  if (tasks.length) sections.push(`Tasks/Commitments:\n${tasks.join("\n")}`);
  if (conflicts.length) sections.push(`Conflicts:\n${conflicts.join("\n")}`);
  if (sources.length) sections.push(`Sources:\n${sources.join("\n")}`);
  let promptBlock = sections.join("\n\n");
  if (promptBlock.length > BUDGET) promptBlock = `${promptBlock.slice(0, BUDGET)}\n[Kontext gekürzt]`;
  return { promptBlock, facts, currentDecisions, historicalDecisions, entities, relations, tasks, conflicts, sources };
}
