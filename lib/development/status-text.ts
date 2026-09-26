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
  const match = prompt.match(/Ursprünglicher Wunsch:\s*(.+?)(?:\n\n|\nZiel:|$)/s);
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
    lines.push("Stand der Entwicklungsaufträge:");
    for (const order of input.orders) {
      lines.push(
        `- ${order.status}: ${cleanGoal(order.goal)} (Iteration ${order.iteration} von ${order.maxIterations})`,
      );
      if (order.resultSummary) lines.push(`  ${order.resultSummary}`);
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
