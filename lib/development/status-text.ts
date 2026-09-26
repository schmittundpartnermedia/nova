export type OrderStatusView = {
  status: string;
  goal: string;
  iteration: number;
  maxIterations: number;
  resultSummary?: string | null;
};

export type CursorWorkView = {
  status: string;
  projectPath: string;
  goal: string;
};

export function summarizeCursorGoal(prompt: string): string {
  const match = prompt.match(/Ursprünglicher Wunsch:\s*(.+)/);
  if (match?.[1]) {
    return cleanGoal(match[1]);
  }
  const first = prompt
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !/^Entwicklungsauftrag/i.test(line));
  return cleanGoal(first ?? "unbekannter Auftrag");
}

export function formatDevelopmentStatusReply(input: {
  orders: OrderStatusView[];
  cursorWork: CursorWorkView[];
  userRequest: string;
}): { reply: string; statusMessage: string } {
  if (input.orders.length === 0 && input.cursorWork.length === 0) {
    return { reply: "Es liegt kein Entwicklungsauftrag vor.", statusMessage: "Kein Auftrag." };
  }

  const lines: string[] = [];
  if (input.cursorWork.length === 0) {
    lines.push("Cursor arbeitet gerade an keinem Auftrag für mich.");
  } else {
    lines.push("Woran Cursor gerade für mich arbeitet:");
    for (const work of input.cursorWork) {
      lines.push(`- ${work.status}: ${work.goal} (Pfad: ${work.projectPath})`);
    }
  }

  if (input.orders.length > 0) {
    const [latest, ...older] = input.orders;
    lines.push("Aktueller Entwicklungsauftrag:");
    lines.push(
      `- ${latest.status}: ${cleanGoal(latest.goal)} (Iteration ${latest.iteration} von ${latest.maxIterations})`,
    );
    if (latest.resultSummary) lines.push(`  ${latest.resultSummary}`);
    const olderOpen = older.filter((order) => order.status !== "completed").length;
    if (olderOpen > 0) lines.push(`Weitere offene Aufträge: ${olderOpen}.`);
  }

  if (/geplant/i.test(input.userRequest)) {
    const planned = input.orders.filter((order) => order.status === "planned");
    if (planned.length === 0) {
      lines.push("Es steht kein Entwicklungsauftrag auf geplant.");
    } else {
      lines.push(planned.length === 1 ? "Geplanter Auftrag, noch nicht gestartet:" : "Geplante Aufträge, noch nicht gestartet:");
      for (const order of planned) lines.push(`- ${cleanGoal(order.goal)}`);
    }
  }

  const askingFailure = /fehlgeschlagen|nicht fertig/i.test(input.userRequest);
  const askingChange = /geändert|geaendert/i.test(input.userRequest);
  const latest = input.orders[0];
  if (askingFailure && latest && latest.status !== "failed" && latest.status !== "blocked") {
    lines.push("Ein Fehler ist im letzten Stand nicht vermerkt.");
  }
  if (askingChange) {
    lines.push("Geändert wird nur das, was Cursor im beauftragten Workspace umgesetzt hat.");
  }
  if (latest?.status === "completed") {
    lines.push("Der letzte Auftrag ist abgeschlossen.");
  }

  const headline = input.cursorWork[0]?.status ?? latest?.status ?? "offen";
  return { reply: lines.join("\n"), statusMessage: `Entwicklung: ${headline}` };
}

function cleanGoal(value: string): string {
  return value.trim().replace(/^[„"]|[“"]$/g, "").slice(0, 240);
}
