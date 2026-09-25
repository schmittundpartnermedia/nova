export type EvalCase = {
  id: string;
  query: string;
  relevant: string[];
  kind: string;
};

export const EVAL_CORPUS: Array<{ id: string; text: string; layer: string; type: string; status?: string; superseded?: boolean; at?: string; project?: string }> = [
  { id: "svc", text: "Zusätzliche rankPilot-Systeme werden außerhalb des App-Codes als eigenständige Services entwickelt.", layer: "knowledge", type: "decision", status: "JOINTLY_DECIDED", project: "rankPilot" },
  { id: "price-old", text: "Der geplante rankPilot Preis lag bei 199 Euro.", layer: "knowledge", type: "price", status: "USER_STATED", superseded: true, at: "2024-03-01", project: "rankPilot" },
  { id: "price-new", text: "Aktueller rankPilot Preis ist 229 Euro.", layer: "knowledge", type: "price", status: "JOINTLY_DECIDED", at: "2025-11-02", project: "rankPilot" },
  { id: "hetzner", text: "Hetzner wird als Alliance Partner für rankPilot geprüft.", layer: "memory", type: "decision", status: "JOINTLY_DECIDED", project: "rankPilot" },
  { id: "listings", text: "Bei rankPilot haben wir entschieden, Listings erst nach dem Pilot freizuschalten.", layer: "knowledge", type: "decision", status: "JOINTLY_DECIDED", project: "rankPilot" },
  { id: "deadline", text: "Die rankPilot Pilot-Deadline ist der 30. September.", layer: "knowledge", type: "deadline", status: "USER_CONFIRMED", at: "2025-09-30", project: "rankPilot" },
  { id: "task", text: "Offene Aufgabe: Listings-Spezifikation bis Freitag an Hetzner schicken.", layer: "memory", type: "task", status: "USER_STATED", project: "rankPilot" },
  { id: "idea", text: "Assistant-Idee: vielleicht später 149 Euro als Einstieg anbieten.", layer: "archive", type: "idea", status: "ASSISTANT_SUGGESTED", at: "2024-01-01", project: "rankPilot" },
  { id: "coffee", text: "Die Bürokaffeemaschine tropft seit Montag.", layer: "archive", type: "fact", status: "USER_STATED" },
  { id: "person", text: "Clara Berg ist Ansprechpartnerin bei Nordlicht, nicht bei rankPilot.", layer: "knowledge", type: "person", status: "USER_STATED" },
  { id: "source", text: "Die Preisänderung auf 229 Euro steht im Angebot v3, Seite 2.", layer: "knowledge", type: "source", status: "TOOL_VERIFIED", project: "rankPilot" },
  { id: "conflict-a", text: "Der Support reagiert innerhalb von 24 Stunden.", layer: "knowledge", type: "fact", status: "USER_STATED", project: "rankPilot" },
  { id: "conflict-b", text: "Der Support reagiert innerhalb von 4 Stunden.", layer: "knowledge", type: "fact", status: "USER_STATED", project: "rankPilot" },
  { id: "alias", text: "Rank Pilot nutzt eigenständige Dienste statt neuer Monolith-Module.", layer: "knowledge", type: "decision", status: "SYSTEM_OBSERVED", project: "rankPilot" },
  { id: "relation", text: "Hetzner considered_as_partner_for rankPilot. Deshalb gelten die Pilot-Entscheidungen auch für den Hoster.", layer: "memory", type: "relation", status: "JOINTLY_DECIDED", project: "rankPilot" },
  { id: "sept", text: "Im September 2025 wurde der Pilotumfang auf Listings und Billing begrenzt.", layer: "knowledge", type: "decision", status: "JOINTLY_DECIDED", at: "2025-09-12", project: "rankPilot" },
  { id: "hist", text: "Früher war ein Marketplace im App-Code geplant.", layer: "knowledge", type: "decision", status: "USER_STATED", superseded: true, at: "2024-05-01", project: "rankPilot" },
  { id: "now", text: "Heute gilt: kein Marketplace im App-Code, nur externe Services.", layer: "knowledge", type: "decision", status: "JOINTLY_DECIDED", at: "2026-01-15", project: "rankPilot" },
  { id: "project", text: "rankPilot ist das Produkt für lokale Sichtbarkeit und Listings.", layer: "knowledge", type: "project", status: "USER_CONFIRMED", project: "rankPilot" },
  { id: "company", text: "Hetzner ist der geprüfte Hosting-Partner.", layer: "knowledge", type: "entity", status: "TOOL_VERIFIED" },
];

export const EVAL_CASES: EvalCase[] = [
  { id: "q1", query: "Bauen wir neue Funktionen direkt in die rankPilot App?", relevant: ["svc", "alias", "now"], kind: "semantic" },
  { id: "q2", query: "Was kostet rankPilot aktuell?", relevant: ["price-new", "source"], kind: "current" },
  { id: "q3", query: "Was war früher der Preis?", relevant: ["price-old"], kind: "historical" },
  { id: "q4", query: "Was haben wir bei rankPilot über Listings entschieden?", relevant: ["listings", "sept"], kind: "decision" },
  { id: "q5", query: "Wer ist Hetzner?", relevant: ["hetzner", "company", "relation"], kind: "entity" },
  { id: "q6", query: "Welche rankPilot Entscheidungen hängen an Hetzner?", relevant: ["relation", "hetzner", "listings"], kind: "relation" },
  { id: "q7", query: "Woher weißt du den Preis von 229 Euro?", relevant: ["source", "price-new"], kind: "source" },
  { id: "q8", query: "Was gilt im September für den Pilot?", relevant: ["sept", "deadline"], kind: "date" },
  { id: "q9", query: "Welche Deadline hat der Pilot?", relevant: ["deadline"], kind: "deadline" },
  { id: "q10", query: "Welche Aufgabe ist offen?", relevant: ["task"], kind: "task" },
  { id: "q11", query: "Rank Pilot Architektur", relevant: ["alias", "svc"], kind: "alias" },
  { id: "q12", query: "Wie schnell ist der Support?", relevant: ["conflict-a", "conflict-b"], kind: "conflict" },
  { id: "q13", query: "Was gilt heute beim Marketplace?", relevant: ["now"], kind: "current" },
  { id: "q14", query: "Was war vorher beim Marketplace geplant?", relevant: ["hist"], kind: "historical" },
  { id: "q15", query: "Beschreibe das Projekt rankPilot", relevant: ["project", "listings"], kind: "project" },
  { id: "q16", query: "Alliance Partner Hosting", relevant: ["hetzner", "company", "relation"], kind: "entity" },
  { id: "q17", query: "Eigenständige Services außerhalb des Codes", relevant: ["svc", "alias"], kind: "semantic" },
  { id: "q18", query: "149 Euro Einstieg", relevant: ["idea"], kind: "source" },
  { id: "q19", query: "Preisänderung Beleg", relevant: ["source", "price-new"], kind: "source" },
  { id: "q20", query: "Pilotfreigabe Listings", relevant: ["listings"], kind: "decision" },
  { id: "q21", query: "Kaffeemaschine", relevant: ["coffee"], kind: "archive" },
  { id: "q22", query: "Ansprechpartnerin Clara", relevant: ["person"], kind: "entity" },
  { id: "q23", query: "Hosting Partner für das Produkt", relevant: ["company", "hetzner", "relation"], kind: "relation" },
  { id: "q24", query: "229 Euro Angebot", relevant: ["price-new", "source"], kind: "current" },
  { id: "q25", query: "199 Euro geplant", relevant: ["price-old"], kind: "historical" },
  { id: "q26", query: "Billing und Listings Umfang", relevant: ["sept"], kind: "date" },
  { id: "q27", query: "externe Services statt Monolith", relevant: ["alias", "svc", "now"], kind: "semantic" },
  { id: "q28", query: "Spezifikation an den Hoster schicken", relevant: ["task", "hetzner"], kind: "task" },
  { id: "q29", query: "Was haben wir gemeinsam entschieden?", relevant: ["listings", "svc", "now", "hetzner"], kind: "decision" },
  { id: "q30", query: "Welche Aussage ist nur eine Assistant-Idee?", relevant: ["idea"], kind: "source" },
  { id: "q31", query: "rankpilot sichtbarkeit", relevant: ["project"], kind: "alias" },
  { id: "q32", query: "vor der Preisänderung", relevant: ["price-old", "hist"], kind: "historical" },
];

export function recallAtK(ranked: string[], relevant: string[], k: number): number {
  const top = new Set(ranked.slice(0, k));
  const hits = relevant.filter((id) => top.has(id)).length;
  return relevant.length ? hits / relevant.length : 0;
}

export function reciprocalRank(ranked: string[], relevant: string[]): number {
  const index = ranked.findIndex((id) => relevant.includes(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

export function aggregateMetrics(rows: Array<{ ranked: string[]; relevant: string[] }>, k = 5) {
  const recall = rows.reduce((sum, row) => sum + recallAtK(row.ranked, row.relevant, k), 0) / rows.length;
  const mrr = rows.reduce((sum, row) => sum + reciprocalRank(row.ranked, row.relevant), 0) / rows.length;
  const top1 = rows.filter((row) => row.relevant.includes(row.ranked[0] ?? "")).length / rows.length;
  const top3 = rows.filter((row) => row.ranked.slice(0, 3).some((id) => row.relevant.includes(id))).length / rows.length;
  return { recallAtK: recall, mrr, top1, top3, queries: rows.length, k };
}
