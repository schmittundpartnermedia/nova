export type DevelopmentDraft = {
  goal: string;
  desiredBehavior: string;
  gap: string;
  requirements: string;
  constraints: string;
  approvalRules: string;
  acceptance: string;
};

export function draftDevelopmentOrder(userRequest: string, existingCapabilities: string): DevelopmentDraft {
  const request = userRequest.trim();
  return {
    goal: request,
    desiredBehavior: request,
    gap: `Diese Fähigkeit ist noch nicht als verifiziertes NOVA-Verhalten abgeschlossen: ${request}\nBereits vorhanden und nicht noch einmal bauen: ${existingCapabilities}`,
    requirements: [
      "Der ursprüngliche Wunsch bleibt über alle Iterationen unverändert.",
      "Vorhandene NOVA-Fähigkeiten werden benutzt, wenn sie das Ziel schon erfüllen.",
      "Das Ergebnis muss im realen System prüfbar sein.",
    ].join("\n"),
    constraints: [
      "Kein Push.",
      "Kein Deployment.",
      "Keine Production-Datenbank verändern.",
      "Keine Zugangsdaten lesen, rotieren oder exportieren.",
      "Keine externen Nachrichten, Zahlungen oder destruktiven Aktionen.",
    ].join("\n"),
    approvalRules:
      "Interne Entwicklung im beauftragten Workspace ist erlaubt. Jede spätere externe Aktion bleibt an die bestehenden Freigaben gebunden.",
    acceptance: [
      "Die gewünschte Fähigkeit ist im Code vorhanden.",
      "Prüfungen, die zur Fähigkeit passen, sind gelaufen.",
      "Ein fehlgeschlagener Lauf ist nicht als fertig markiert.",
      "Joachim kann das Ergebnis abnehmen.",
    ].join("\n"),
  };
}

export function buildCursorCommission(input: {
  userRequest: string;
  draft: DevelopmentDraft;
  existingCapabilities: string;
  workspacePath?: string | null;
  previousFinding?: string;
}): string {
  return [
    "Entwicklungsauftrag von NOVA.",
    "Definiert ist das Ziel, nicht die technische Umsetzung.",
    "Untersuche das Repository selbst. Erkenne, was schon existiert. Entscheide selbst, wie es an der Ursache korrekt gebaut wird.",
    "Schreibe keine parallele Architektur, wenn ein vorhandenes System erweitert werden kann.",
    `Ursprünglicher Wunsch: ${input.userRequest}`,
    `Ziel: ${input.draft.goal}`,
    `Gewünschtes Verhalten: ${input.draft.desiredBehavior}`,
    `Vorhandene Fähigkeiten: ${input.existingCapabilities}`,
    `Lücke: ${input.draft.gap}`,
    `Anforderungen:\n${input.draft.requirements}`,
    `Einschränkungen:\n${input.draft.constraints}`,
    `Freigaben:\n${input.draft.approvalRules}`,
    `Abnahme:\n${input.draft.acceptance}`,
    input.workspacePath ? `Workspace: ${input.workspacePath}` : "",
    input.previousFinding ? `Vorheriger Lauf war nicht ausreichend. Befund: ${input.previousFinding}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function mapCodingOutcome(input: {
  verified: boolean;
  status: string;
  summary: string;
  iteration: number;
  maxIterations: number;
}): "waiting_review" | "developing" | "blocked" | "failed" {
  if (input.verified) return "waiting_review";
  if (/nicht verfügbar|nicht angemeldet|nicht erreichbar|außerhalb erlaubter/i.test(input.summary)) return "blocked";
  if (input.status === "CANCELLED_BY_USER") return "failed";
  if (input.iteration + 1 < input.maxIterations) return "developing";
  return "failed";
}
