export const EXECUTED_ACTIVITY_STATUSES = ["executed"] as const;
export const PREPARED_ACTIVITY_STATUSES = ["suggested", "prepared"] as const;

export function assertActivityStatusHonesty(input: {
  status: string;
  actuallyExecutedExternally: boolean;
}): void {
  if (input.status === "executed" && !input.actuallyExecutedExternally) {
    throw new Error(
      "NOVA darf eine Aktivität nicht als 'executed' speichern, wenn keine echte externe Aktion stattgefunden hat.",
    );
  }
}
