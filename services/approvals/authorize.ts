import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import {
  createApprovalRequest,
  findMatchingPolicy,
  isStandingActionType,
  mailsSentToday,
  policyMaxPerDay,
  scannerRunsToday,
} from "@/services/approvals";

/**
 * Zentrale Freigabe vor jeder extern wirksamen Aktion.
 * Prüft nur – verbraucht nichts. Das Tageslimit einer Dauerfreigabe zählt tatsächlich
 * ausgeführte Aktionen (bei Mail: im Ordner Gesendet bestätigte Mails), nicht Prüfungen.
 */

export type ExternalRiskLevel = "external" | "irreversible";

export type AuthorizeExternalInput = {
  organizationId: string;
  actionType: string;
  description: string;
  payload?: Record<string, unknown>;
  jobId?: string;
  /** Vom Nutzer erteilte Einzelfreigabe (ApprovalRequest mit Status approved). */
  approvalToken?: string;
  riskLevel: ExternalRiskLevel;
  /** Für Policy-Bedingungen (Empfänger-Domains). */
  conditions?: { recipientDomain?: string };
};

export type AuthorizeExternalResult =
  | { decision: "allow"; reason: string; via: "token" | "standing"; policyId?: string; approvalId?: string }
  | { decision: "deny_hard"; reason: string }
  | { decision: "need_approval"; reason: string; approvalId: string };

/** Unumkehrbare Aktionen sind nie per Dauerfreigabe freigebbar. */
export function isIrreversibleAction(actionType: string, riskLevel: ExternalRiskLevel): boolean {
  if (riskLevel === "irreversible") return true;
  return /delete|payment|pay\.|publish|deploy|force.?push|destroy/i.test(actionType);
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function recipientDomainAllowed(policy: { conditions: string }, recipientDomain?: string): boolean {
  const cfg = parseJsonObject(policy.conditions);
  const allowed = Array.isArray(cfg.allowedRecipientDomains)
    ? cfg.allowedRecipientDomains.map((item) => String(item).toLowerCase())
    : [];
  if (!allowed.length) return true;
  const domain = String(recipientDomain ?? "").trim().toLowerCase().split("@").pop() ?? "";
  return Boolean(domain) && allowed.some((item) => domain === item || domain.endsWith(`.${item}`));
}

async function executedToday(organizationId: string, actionType: string): Promise<number> {
  if (actionType === "mail.send") return mailsSentToday(organizationId);
  if (actionType === "scanner.start") return scannerRunsToday(organizationId);
  return 0;
}

export async function authorizeExternalAction(input: AuthorizeExternalInput): Promise<AuthorizeExternalResult> {
  assertOrganizationId(input.organizationId);

  if (input.approvalToken) {
    const granted = await prisma.approvalRequest.findFirst({
      where: {
        id: input.approvalToken,
        organizationId: input.organizationId,
        actionType: input.actionType,
        status: "approved",
      },
    });
    if (granted) {
      return { decision: "allow", reason: "Einzelfreigabe liegt vor.", via: "token", approvalId: granted.id };
    }
  }

  const irreversible = isIrreversibleAction(input.actionType, input.riskLevel);
  let reason = irreversible ? "Unumkehrbare Aktion – nur Einzelfreigabe." : "Keine Dauerfreigabe.";

  if (!irreversible && isStandingActionType(input.actionType)) {
    const policy = await findMatchingPolicy({ organizationId: input.organizationId, actionType: input.actionType });
    if (policy) {
      const maxPerDay = policyMaxPerDay(policy);
      const used = maxPerDay > 0 ? await executedToday(input.organizationId, input.actionType) : 0;
      if (!recipientDomainAllowed(policy, input.conditions?.recipientDomain)) {
        reason = "Empfänger-Domain ist in der Dauerfreigabe nicht erlaubt.";
      } else if (maxPerDay > 0 && used >= maxPerDay) {
        reason = `Tageslimit der Dauerfreigabe erreicht (${used}/${maxPerDay}).`;
      } else {
        return { decision: "allow", reason: `Dauerfreigabe „${policy.name}“.`, via: "standing", policyId: policy.id };
      }
    }
  }

  const approval = await createApprovalRequest({
    organizationId: input.organizationId,
    jobId: input.jobId,
    actionType: input.actionType,
    description: input.description,
    payload: {
      ...(input.payload ?? {}),
      riskLevel: input.riskLevel,
      irreversible,
      conditions: input.conditions ?? {},
    },
  });
  return { decision: "need_approval", reason, approvalId: approval.id };
}
