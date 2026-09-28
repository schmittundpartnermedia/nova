import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import {
  consumeStandingApproval,
  createApprovalRequest,
  findMatchingPolicy,
  isStandingActionType,
  type StandingActionType,
} from "@/services/approvals";

/**
 * Zentrale Freigabe vor jeder extern wirksamen Aktion.
 * Alle Pfade (Master, Mail, Computer, Worker) sollen hier entlang.
 */

export type ExternalRiskLevel = "read" | "change" | "external" | "irreversible";

export type AuthorizeExternalInput = {
  organizationId: string;
  actionType: string;
  description: string;
  payload?: Record<string, unknown>;
  jobId?: string;
  /** Bereits erteilte Einzelfreigabe */
  approvalToken?: string;
  riskLevel: ExternalRiskLevel;
  /** Für Policy-Bedingungen (erlaubte Apps, Empfänger-Domains) */
  conditions?: {
    app?: string;
    recipientDomain?: string;
  };
  /** Wenn false, keine Freigabe nötig (nur lesen / beauftragte Workspace-Änderung) */
  requiresApproval?: boolean;
};

export type AuthorizeExternalResult =
  | {
      decision: "allow";
      reason: string;
      via: "not_required" | "token" | "standing";
      policyId?: string;
      approvalId?: string;
    }
  | {
      decision: "deny_hard";
      reason: string;
    }
  | {
      decision: "need_approval";
      reason: string;
      approvalId: string;
    };

/** Unumkehrbare Aktionen sind nie per Dauerfreigabe freigebbar. */
export function isIrreversibleAction(actionType: string, riskLevel: ExternalRiskLevel): boolean {
  if (riskLevel === "irreversible") return true;
  return /delete|payment|pay\.|publish|deploy|force.?push|destroy/i.test(actionType);
}

export function standingActionTypeFor(actionType: string): StandingActionType | null {
  if (actionType === "mail.send" || actionType === "mail.send.batch") return "mail.send.batch";
  if (actionType === "macos.ui.click" || actionType === "computer.accessibility" || actionType === "computer.accessibility.press") {
    return "macos.ui.click";
  }
  if (isStandingActionType(actionType)) return actionType;
  return null;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function domainOf(emailOrDomain?: string): string | undefined {
  if (!emailOrDomain) return undefined;
  const value = emailOrDomain.trim().toLowerCase();
  if (!value) return undefined;
  if (value.includes("@")) return value.split("@").pop();
  return value.replace(/^\./, "");
}

function policyAllowsConditions(
  policy: { conditions: string },
  conditions?: AuthorizeExternalInput["conditions"],
): { ok: boolean; reason: string } {
  const cfg = parseJsonObject(policy.conditions);
  const allowedApps = Array.isArray(cfg.allowedApps)
    ? cfg.allowedApps.map((item) => String(item).toLowerCase())
    : [];
  const allowedDomains = Array.isArray(cfg.allowedRecipientDomains)
    ? cfg.allowedRecipientDomains.map((item) => String(item).toLowerCase())
    : [];

  if (allowedApps.length && conditions?.app) {
    if (!allowedApps.includes(conditions.app.toLowerCase())) {
      return { ok: false, reason: `App „${conditions.app}“ ist in der Dauerfreigabe nicht erlaubt.` };
    }
  }
  if (allowedDomains.length) {
    const domain = domainOf(conditions?.recipientDomain);
    if (!domain || !allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))) {
      return { ok: false, reason: "Empfänger-Domain ist in der Dauerfreigabe nicht erlaubt." };
    }
  }
  return { ok: true, reason: "Bedingungen erfüllt." };
}

/**
 * Vor jeder extern wirksamen Aktion aufrufen.
 * - not_required: lesen / keine Freigabe nötig
 * - token: gültige Einzelfreigabe
 * - standing: Dauerfreigabe (nie für irreversible)
 * - need_approval: ApprovalRequest angelegt
 * - deny_hard: hart blockiert
 */
export async function authorizeExternalAction(input: AuthorizeExternalInput): Promise<AuthorizeExternalResult> {
  assertOrganizationId(input.organizationId);

  if (input.approvalToken) {
    const existing = await prisma.approvalRequest.findFirst({
      where: {
        id: input.approvalToken,
        organizationId: input.organizationId,
        status: "approved",
      },
    });
    if (existing) {
      return {
        decision: "allow",
        reason: "Einzelfreigabe liegt vor.",
        via: "token",
        approvalId: existing.id,
      };
    }
  }

  const irreversible = isIrreversibleAction(input.actionType, input.riskLevel);
  const standingType = irreversible ? null : standingActionTypeFor(input.actionType);

  // Dauerfreigabe: auch bei „eigentlich keine Freigabe nötig“, wenn Policy existiert
  // (Tageslimit + App-/Domain-Bedingungen produktiv durchsetzen).
  if (standingType) {
    const policy = await findMatchingPolicy({
      organizationId: input.organizationId,
      actionType: standingType,
    });
    if (policy) {
      const conditions = policyAllowsConditions(policy, input.conditions);
      if (!conditions.ok) {
        if (input.requiresApproval === false) {
          return { decision: "deny_hard", reason: conditions.reason };
        }
      } else {
        const consumed = await consumeStandingApproval({
          organizationId: input.organizationId,
          actionType: standingType,
          jobId: input.jobId,
          description: input.description,
          payload: {
            ...(input.payload ?? {}),
            sourceActionType: input.actionType,
            conditions: input.conditions ?? {},
          },
        });
        if (consumed.allowed) {
          return {
            decision: "allow",
            reason: consumed.reason,
            via: "standing",
            policyId: consumed.policyId,
          };
        }
        if (input.requiresApproval === false) {
          return {
            decision: "need_approval",
            reason: consumed.reason,
            approvalId: (
              await createApprovalRequest({
                organizationId: input.organizationId,
                jobId: input.jobId,
                actionType: input.actionType,
                description: `${input.description} (${consumed.reason})`,
                payload: {
                  ...(input.payload ?? {}),
                  riskLevel: input.riskLevel,
                  irreversible,
                  conditions: input.conditions ?? {},
                  executed: false,
                },
              })
            ).id,
          };
        }
      }
    }
  }

  if (input.requiresApproval === false) {
    return { decision: "allow", reason: "Keine Freigabe nötig.", via: "not_required" };
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
      executed: false,
    },
  });

  return {
    decision: "need_approval",
    reason: irreversible
      ? "Unumkehrbare Aktion — nur Einzelfreigabe."
      : "Externe Aktion braucht Freigabe.",
    approvalId: approval.id,
  };
}

export function riskLevelFromComputerRisk(risk: string): ExternalRiskLevel {
  if (risk === "READ_ONLY") return "read";
  if (risk === "WORKSPACE_WRITE" || risk === "SYSTEM_CHANGE") return "change";
  if (risk === "DESTRUCTIVE" || risk === "PRIVILEGED") return "irreversible";
  return "external";
}
