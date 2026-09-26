import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";

const ACTIVE = ["planned", "developing", "built", "tests_passed", "verified", "waiting_review", "blocked"];

export async function explainDevelopment(organizationId: string, userRequest: string) {
  assertOrganizationId(organizationId);
  const order = await prisma.developmentOrder.findFirst({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
  });
  if (!order) {
    return { reply: "Es liegt kein Entwicklungsauftrag vor.", statusMessage: "Kein Auftrag." };
  }
  const askingFailure = /fehlgeschlagen|nicht fertig/i.test(userRequest);
  const askingChange = /geändert|geaendert/i.test(userRequest);
  const lines = [
    `Status: ${order.status}.`,
    `Ziel: ${order.goal}`,
    `Iteration: ${order.iteration} von ${order.maxIterations}.`,
  ];
  if (order.resultSummary) lines.push(order.resultSummary);
  if (askingFailure && order.status !== "failed" && order.status !== "blocked") {
    lines.push("Ein Fehler ist im letzten Stand nicht vermerkt.");
  }
  if (askingChange) lines.push("Geändert wird nur das, was Cursor im beauftragten Workspace umgesetzt hat.");
  if (!ACTIVE.includes(order.status) && order.status === "completed") {
    lines.push("Der Auftrag ist abgeschlossen.");
  }
  return { reply: lines.join("\n"), statusMessage: `Entwicklung: ${order.status}` };
}
