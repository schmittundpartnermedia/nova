export type QueryIntent =
  | "decision"
  | "price"
  | "deadline"
  | "task"
  | "source"
  | "temporal_comparison"
  | "historical"
  | "current"
  | "entity"
  | "general";

export type QueryTime = {
  mode: "current" | "historical" | "comparison" | "range" | "any";
  month?: number;
  year?: number;
  label?: string;
};

export type QueryUnderstanding = {
  raw: string;
  intent: QueryIntent;
  entities: string[];
  projects: string[];
  time: QueryTime;
  wantsSupersessionHistory: boolean;
  sourceQuestion: boolean;
  keywords: string[];
};

const MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  märz: 3,
  marz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12,
};

export function understandQuery(query: string, knownEntities: string[] = []): QueryUnderstanding {
  const raw = query.trim();
  const lower = raw.toLowerCase();
  const entities = knownEntities.filter((name) => {
    const compact = name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "");
    const queryCompact = lower.replace(/[^a-z0-9äöüß]+/gi, "");
    if (!compact || compact.length < 3) return false;
    return queryCompact.includes(compact) || lower.includes(name.toLowerCase());
  });
  const time = parseTime(lower);
  const sourceQuestion = /woher|quelle|worauf|beleg|nachweis/.test(lower);
  const comparison = /früher|vorher|damals|heute|aktuell|jetzt|gilt/.test(lower) && /früher|vorher|damals|alt/.test(lower) && /heute|aktuell|jetzt|gilt/.test(lower);
  let intent: QueryIntent = "general";
  if (sourceQuestion) intent = "source";
  else if (comparison) intent = "temporal_comparison";
  else if (/entsch(?:eid|ied)/.test(lower)) intent = "decision";
  else if (/preis|kostet|€|euro/.test(lower)) intent = "price";
  else if (/deadline|frist|bis wann|fällig/.test(lower)) intent = "deadline";
  else if (/aufgabe|commitment|zusage|todo/.test(lower)) intent = "task";
  else if (time.mode === "historical") intent = "historical";
  else if (time.mode === "current") intent = "current";
  else if (entities.length) intent = "entity";

  const keywords = lower
    .split(/[^a-z0-9äöüß]+/i)
    .filter((token) => token.length > 2 && !STOP.has(token));

  return {
    raw,
    intent,
    entities,
    projects: entities.filter((name) => /projekt|pilot|app/i.test(name) || knownEntities.includes(name)),
    time,
    wantsSupersessionHistory: intent === "temporal_comparison" || intent === "historical" || /früher|vorher|geplant|alt/.test(lower),
    sourceQuestion,
    keywords,
  };
}

const STOP = new Set(["und", "oder", "der", "die", "das", "wir", "ist", "sind", "was", "wie", "bei", "für", "fur", "mit", "von", "den", "dem", "ein", "eine", "haben", "hat", "nicht", "über", "ueber"]);

function parseTime(lower: string): QueryTime {
  const yearMatch = lower.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  let month: number | undefined;
  for (const [name, value] of Object.entries(MONTHS)) {
    if (lower.includes(name)) month = value;
  }
  const historical = /früher|damals|vorher|zuletzt davor|alt(e|er|en)?\b|geplant/.test(lower);
  const current = /aktuell|heute|jetzt|derzeit|gilt|zurzeit/.test(lower);
  if (historical && current) return { mode: "comparison", month, year, label: "comparison" };
  if (month || year) return { mode: "range", month, year, label: [month, year].filter(Boolean).join("-") };
  if (historical) return { mode: "historical", label: "historical" };
  if (current || /zuletzt/.test(lower)) return { mode: "current", label: "current" };
  return { mode: "any" };
}
