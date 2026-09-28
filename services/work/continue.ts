import { parseSlotValue } from "@/lib/work/slots";
import { looksLikeAccountAffirmative, looksLikeAccountPick } from "@/lib/mail/draft-spec";
import {
  loadOpenActiveWork,
  setActiveWorkStatus,
  summarizeActiveWork,
  updateActiveWorkSlots,
  type ActiveWorkRecord,
} from "@/services/work/active";
import type { OrbState } from "@/types";

export type ContinueWorkResult = {
  handled: boolean;
  reply: string;
  statusMessage: string;
  orbState: OrbState;
  approvalId?: string;
  actionType?: string;
  work?: ActiveWorkRecord;
};

export async function continueActiveWork(input: {
  organizationId: string;
  conversationId?: string;
  userRequest: string;
}): Promise<ContinueWorkResult | null> {
  const work = await loadOpenActiveWork({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
  });
  if (!work) return null;

  if (/^(abbrechen|cancel|stopp|vergiss(?: es)?)\.?$/i.test(input.userRequest.trim())) {
    await setActiveWorkStatus({
      organizationId: input.organizationId,
      workId: work.id,
      status: "cancelled",
      evidence: "Vom Benutzer abgebrochen.",
    });
    return {
      handled: true,
      reply: "Alles klar. Der offene Auftrag ist abgebrochen. Es wurde nichts weiter ausgeführt.",
      statusMessage: "Auftrag abgebrochen.",
      orbState: "DONE",
      work,
    };
  }

  if (work.status === "clarifying" && work.missingSlots.length) {
    const key = work.missingSlots[0]!;

    // Mail-Absender: Spezialpfad (ja / Adresse / Nummer) über prepareMailDraft.
    if (work.domain === "mail" && key === "from") {
      return executeReadyWork({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        work,
        userRequest: input.userRequest,
      });
    }

    const value = parseSlotValue(key, input.userRequest);
    if (!value) {
      return {
        handled: true,
        reply: work.lastQuestion ?? `Bitte noch angeben: ${key}.`,
        statusMessage: "Angabe fehlt.",
        orbState: "DONE",
        work,
      };
    }
    const updated = await updateActiveWorkSlots({
      organizationId: input.organizationId,
      workId: work.id,
      slots: { [key]: value },
      brief: `${work.brief}\n${input.userRequest}`.trim(),
    });
    if (updated.missingSlots.length) {
      return {
        handled: true,
        reply: updated.lastQuestion ?? `Bitte noch: ${updated.missingSlots[0]}.`,
        statusMessage: "Noch eine Angabe.",
        orbState: "DONE",
        work: updated,
      };
    }
    return executeReadyWork({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      work: updated,
      userRequest: input.userRequest,
    });
  }

  if (work.status === "ready" || work.status === "clarifying") {
    return executeReadyWork({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      work,
      userRequest: input.userRequest,
    });
  }

  if (work.status === "waiting_approval") {
    return {
      handled: true,
      reply: `Der Auftrag wartet noch auf Freigabe.\n${summarizeActiveWork(work)}\nSag „freigeben“ oder nutze die Freigabe-Karte.`,
      statusMessage: "Freigabe erforderlich.",
      orbState: "WAITING_FOR_APPROVAL",
      work,
    };
  }

  return {
    handled: true,
    reply: `Ich arbeite noch an: ${summarizeActiveWork(work)}. Status: ${work.status}.`,
    statusMessage: "Auftrag läuft.",
    orbState: "WORKING",
    work,
  };
}

async function executeReadyWork(input: {
  organizationId: string;
  conversationId?: string;
  work: ActiveWorkRecord;
  userRequest: string;
}): Promise<ContinueWorkResult> {
  await setActiveWorkStatus({
    organizationId: input.organizationId,
    workId: input.work.id,
    status: "executing",
  });

  if (input.work.domain === "mail") {
    const { prepareMailDraft } = await import("@/services/mail/draft");
    // Minimaler Slot-Brief; Absender-Antwort nur bei Konto-Wahl anhängen.
    const base = composeMailBrief(input.work);
    const accountUtterance =
      looksLikeAccountPick(input.userRequest) || looksLikeAccountAffirmative(input.userRequest);
    // Absender vorne anhängen, damit er nicht in „Inhalt:“ rutscht.
    const brief =
      !input.work.slots.from && accountUtterance ? `${input.userRequest}. ${base}`.trim() : base;
    const draft = await prepareMailDraft({
      organizationId: input.organizationId,
      userRequest: brief,
    });
    if (draft.needsAccount) {
      const updated = await setActiveWorkStatus({
        organizationId: input.organizationId,
        workId: input.work.id,
        status: "clarifying",
        lastQuestion: draft.reply,
        linkedIds: { awaitingFrom: "1" },
      });
      return {
        handled: true,
        reply: draft.reply,
        statusMessage: "Absender wählen.",
        orbState: "DONE",
        work: updated,
      };
    }
    if (draft.approvalId) {
      const fromMatch = draft.reply.match(/Absender:\s*([^\n]+)/i);
      if (fromMatch?.[1]) {
        await updateActiveWorkSlots({
          organizationId: input.organizationId,
          workId: input.work.id,
          slots: { from: fromMatch[1].trim() },
        });
      }
      await setActiveWorkStatus({
        organizationId: input.organizationId,
        workId: input.work.id,
        status: "waiting_approval",
        linkedIds: draft.communicationId ? { communicationId: draft.communicationId } : undefined,
      });
      return {
        handled: true,
        reply: draft.reply,
        statusMessage: "Entwurf wartet auf Freigabe.",
        orbState: "WAITING_FOR_APPROVAL",
        approvalId: draft.approvalId,
        actionType: "mail.send",
        work: input.work,
      };
    }
    await setActiveWorkStatus({
      organizationId: input.organizationId,
      workId: input.work.id,
      status: draft.ok ? "done" : "failed",
      evidence: draft.reply,
    });
    return {
      handled: true,
      reply: draft.reply,
      statusMessage: draft.ok ? "Mailauftrag." : "Mailauftrag fehlgeschlagen.",
      orbState: draft.ok ? "DONE" : "ERROR",
      work: input.work,
    };
  }

  if (input.work.domain === "calendar") {
    return runLocalDomain(input, "calendar", "calendar", {
      userRequest: composeCalendarBrief(input.work),
      title: input.work.slots.title || input.work.goal,
      when: input.work.slots.when || "",
    });
  }
  if (input.work.domain === "ticket") {
    return runLocalDomain(input, "task", "create-task", {
      title: input.work.slots.title || input.work.goal,
      description: input.work.slots.description || input.work.brief,
      dueDays: 1,
      ticket: true,
    });
  }
  if (input.work.domain === "contact") {
    return runLocalDomain(input, "contact", "contact", {
      userRequest: composeContactBrief(input.work),
    });
  }
  if (input.work.domain === "project") {
    return runLocalDomain(input, "project", "create", {
      create: true,
      name: input.work.slots.name || input.work.goal,
    });
  }

  if (input.work.domain === "computer") {
    const goal = input.work.slots.goal || input.work.goal;
    await setActiveWorkStatus({
      organizationId: input.organizationId,
      workId: input.work.id,
      status: "clarifying",
      lastQuestion: "Welchen konkreten Mac-Schritt soll ich ausführen? (App öffnen, Datei suchen, klicken, Screenshot, …)",
    });
    return {
      handled: true,
      reply: `Ich habe den Mac-Auftrag „${goal}“ gemerkt. Sag mir den nächsten konkreten Schritt (z. B. „öffne TextEdit“ oder „Screenshot“).`,
      statusMessage: "Nächster Schritt fehlt.",
      orbState: "DONE",
      work: input.work,
    };
  }

  if (input.work.domain === "coding") {
    const pathSlot = input.work.slots.path?.trim();
    const task = input.work.slots.task || input.work.goal;
    if (!pathSlot) {
      await setActiveWorkStatus({
        organizationId: input.organizationId,
        workId: input.work.id,
        status: "clarifying",
        lastQuestion: "In welchem Projektpfad soll ich den Coding-Auftrag ausführen?",
      });
      return {
        handled: true,
        reply: `Ich habe den Coding-Auftrag „${task}“ gemerkt. Nenne bitte den absoluten Projektpfad.`,
        statusMessage: "Pfad fehlt.",
        orbState: "DONE",
        work: input.work,
      };
    }
    const { runCodingAgent } = await import("@/agents/coding");
    const coding = await runCodingAgent({
      organizationId: input.organizationId,
      userRequest: `${task} (Pfad: ${pathSlot})`,
      workspacePath: pathSlot,
    });
    const verified = coding.verified === true || coding.status === "VERIFIED";
    await setActiveWorkStatus({
      organizationId: input.organizationId,
      workId: input.work.id,
      status: verified ? "done" : "failed",
      evidence: coding.reply || coding.summary,
    });
    return {
      handled: true,
      reply: coding.reply || coding.summary,
      statusMessage: verified ? "Erledigt und geprüft." : coding.statusMessage || "Nicht verifiziert.",
      orbState: verified ? "DONE" : "ERROR",
      approvalId: coding.approvalId,
      work: input.work,
    };
  }

  await setActiveWorkStatus({
    organizationId: input.organizationId,
    workId: input.work.id,
    status: "failed",
    evidence: `Domain ${input.work.domain} ist im ActiveWork-Executor noch nicht angebunden.`,
  });
  return {
    handled: true,
    reply: `Den Auftrag „${input.work.goal}“ habe ich gemerkt, die Ausführung für ${input.work.domain} ist noch nicht angebunden. Es wurde nichts ausgeführt.`,
    statusMessage: "Domain noch offen.",
    orbState: "ERROR",
    work: input.work,
  };
}

async function runLocalDomain(
  input: {
    organizationId: string;
    work: ActiveWorkRecord;
  },
  agentId: "calendar" | "task" | "contact" | "project",
  _action: string,
  payload: Record<string, unknown>,
): Promise<ContinueWorkResult> {
  const { bootstrapAgents, getAgent } = await import("@/agents/bootstrap");
  bootstrapAgents();
  const { getDefaultProject } = await import("@/agents/runtime");
  const agent = getAgent(agentId);
  if (!agent) {
    await setActiveWorkStatus({
      organizationId: input.organizationId,
      workId: input.work.id,
      status: "failed",
      evidence: `Agent ${agentId} fehlt.`,
    });
    return {
      handled: true,
      reply: `Der Agent ${agentId} fehlt. Es wurde nichts ausgeführt.`,
      statusMessage: "Fehler.",
      orbState: "ERROR",
      work: input.work,
    };
  }
  const project = await getDefaultProject(input.organizationId);
  const result = await agent.run(payload, {
    organizationId: input.organizationId,
    jobId: `active-work:${input.work.id}`,
    userRequest: input.work.brief,
    goal: input.work.goal,
    projectId: project?.id,
  });
  const ok = Boolean(result.ok);
  const reply = result.summary || (ok ? "Erledigt und geprüft." : "Nicht erledigt.");
  await setActiveWorkStatus({
    organizationId: input.organizationId,
    workId: input.work.id,
    status: ok ? "done" : "failed",
    evidence: reply,
  });
  return {
    handled: true,
    reply,
    statusMessage: ok ? "Erledigt und geprüft." : "Nicht erledigt.",
    orbState: ok ? "DONE" : "ERROR",
    work: input.work,
  };
}

function composeMailBrief(work: ActiveWorkRecord): string {
  const parts = ["Schreib eine Mail"];
  if (work.slots.from) parts.push(`von ${work.slots.from}`);
  if (work.slots.to) parts.push(`an ${work.slots.to}`);
  if (work.slots.subject) parts.push(`Betreff: ${work.slots.subject}`);
  if (work.slots.body) {
    parts.push(`Inhalt: ${work.slots.body}`);
  }
  return `${parts.join(". ")}.`;
}

function composeCalendarBrief(work: ActiveWorkRecord): string {
  const title = work.slots.title || work.goal;
  const when = work.slots.when || "";
  return `Bitte Termin anlegen: ${title}. ${when}`;
}

function composeContactBrief(work: ActiveWorkRecord): string {
  const name = work.slots.name || work.goal;
  const email = work.slots.email ? ` E-Mail ${work.slots.email}` : "";
  return `Lege den Kontakt ${name} an.${email}`;
}

export async function startActiveWorkFromIntent(input: {
  organizationId: string;
  conversationId?: string;
  domain: ActiveWorkRecord["domain"];
  goal: string;
  brief: string;
  slots?: Record<string, string>;
}): Promise<ContinueWorkResult> {
  const { createActiveWork } = await import("@/services/work/active");
  const work = await createActiveWork(input);
  if (work.missingSlots.length) {
    return {
      handled: true,
      reply: work.lastQuestion ?? `Bitte noch: ${work.missingSlots[0]}.`,
      statusMessage: "Angabe fehlt.",
      orbState: "DONE",
      work,
    };
  }
  return executeReadyWork({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    work,
    userRequest: input.brief,
  });
}
