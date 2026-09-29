import { prepareMailAccess } from "@/services/mail/access";
import { ensureAppleMailFresh } from "@/services/mail/apple-connect";
import { summarizeInbox } from "@/services/mail/inbox";
import { getMailThread, searchMail } from "@/services/mail/search";
import { prepareMailDraft } from "@/services/mail/draft";
import { deliverApprovedDraft } from "@/services/mail/send";
import { mailExcerpt } from "@/lib/mail/html";
import { prisma } from "@/lib/prisma";
import { authorizeExternalAction } from "@/services/approvals/authorize";
import { createStandingPolicy, decideApproval } from "@/services/approvals";
import {
  fuelleVorlage,
  importVorlagenInDb,
  listeVorlagenDateien,
} from "@/lib/mail/vorlagen-files";
import type { NovaToolDefinition, NovaToolResult, ToolContext } from "@/services/tools/types";

function ok(data: unknown, executed = false): NovaToolResult {
  return { ok: true, executed, data };
}

function fail(error: string): NovaToolResult {
  return { ok: false, executed: false, error };
}

export const mailLesenTool: NovaToolDefinition = {
  name: "mail_lesen",
  description:
    "Liest bzw. fasst Mails aus Apple Mail zusammen. modus=neueste (Standard), ungelesen (Zusammenfassung mit Fokus auf neue), oder thread (eine Mail/Person suchen).",
  parameters: {
    type: "object",
    properties: {
      modus: {
        type: "string",
        enum: ["neueste", "ungelesen", "thread"],
        description: "neueste | ungelesen | thread",
      },
      suchbegriff: {
        type: "string",
        description: "Bei modus=thread: Absender, Betreff oder Stichwort.",
      },
    },
    required: ["modus", "suchbegriff"],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<NovaToolResult> {
    const modus = String(args.modus ?? "neueste");
    const suchbegriff = String(args.suchbegriff ?? "").trim();
    try {
      if (modus === "thread") {
        const access = await prepareMailAccess({
          organizationId: ctx.organizationId,
          capability: "MAIL_SEARCH",
          action: "suchen",
        });
        if (!access.ready) return fail(access.reply);
        await ensureAppleMailFresh(ctx.organizationId).catch(() => undefined);
        const hits = await searchMail({
          organizationId: ctx.organizationId,
          query: suchbegriff || "mail",
          limit: 5,
        });
        if (!hits.length) return ok({ zusammenfassung: "Dazu liegt im lokalen Postfach nichts." });
        const top = hits[0]!;
        const thread = await getMailThread(ctx.organizationId, top.threadId);
        return ok({
          zusammenfassung: `${top.fromName || top.fromAddress} – ${top.subject}\n${mailExcerpt(top.normalizedText)}\n\nVerlauf: ${thread?.messages.length ?? 1} Nachricht(en).`,
          messageId: top.id,
          threadId: top.threadId,
        });
      }

      const access = await prepareMailAccess({
        organizationId: ctx.organizationId,
        capability: "MAIL_READ",
        action: "lesen",
      });
      if (!access.ready) return fail(access.reply);
      await ensureAppleMailFresh(ctx.organizationId).catch(() => undefined);
      const zusammenfassung = await summarizeInbox(ctx.organizationId);
      return ok({ zusammenfassung });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Mail lesen fehlgeschlagen.");
    }
  },
};

export const mailEntwurfTool: NovaToolDefinition = {
  name: "mail_entwurf",
  description:
    "Legt einen neuen Mail-Entwurf an (noch kein Versand). Übergib den Auftrag als freie Anweisung (an wen, Absender, Inhalt). Zum Kürzen/Ändern eines offenen Entwurfs erneut aufrufen mit dem Änderungswunsch.",
  parameters: {
    type: "object",
    properties: {
      auftrag: {
        type: "string",
        description: "Vollständige Anweisung, z. B. „Antworte auf die von X: wir melden uns nächste Woche“ oder „Mach es kürzer“.",
      },
    },
    required: ["auftrag"],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<NovaToolResult> {
    try {
      const draft = await prepareMailDraft({
        organizationId: ctx.organizationId,
        userRequest: String(args.auftrag ?? ""),
        jobId: ctx.jobId,
      });
      return {
        ok: draft.ok,
        executed: false,
        data: {
          reply: draft.reply,
          communicationId: draft.communicationId,
          approvalId: draft.approvalId,
          waitingApproval: draft.waitingApproval,
          needsAccount: draft.needsAccount,
        },
        error: draft.ok ? undefined : draft.reply,
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Entwurf fehlgeschlagen.");
    }
  },
};

export const mailAntwortenTool: NovaToolDefinition = {
  name: "mail_antworten",
  description:
    "Antwortet auf eine vorhandene Mail: legt einen Antwort-Entwurf vor (kein Versand). Nutze suchbegriff für Absender/Betreff und inhalt für die gewünschte Antwort.",
  parameters: {
    type: "object",
    properties: {
      suchbegriff: { type: "string", description: "Absender oder Betreff der Originalmail." },
      inhalt: { type: "string", description: "Was die Antwort sagen soll." },
    },
    required: ["suchbegriff", "inhalt"],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<NovaToolResult> {
    const suchbegriff = String(args.suchbegriff ?? "").trim();
    const inhalt = String(args.inhalt ?? "").trim();
    const auftrag = `Antworte auf die Mail von bzw. zu „${suchbegriff}“: ${inhalt}`;
    try {
      const draft = await prepareMailDraft({
        organizationId: ctx.organizationId,
        userRequest: auftrag,
        jobId: ctx.jobId,
      });
      return {
        ok: draft.ok,
        executed: false,
        data: {
          reply: draft.reply,
          communicationId: draft.communicationId,
          approvalId: draft.approvalId,
          waitingApproval: draft.waitingApproval,
        },
        error: draft.ok ? undefined : draft.reply,
      };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Antwort-Entwurf fehlgeschlagen.");
    }
  },
};

export const mailSendenTool: NovaToolDefinition = {
  name: "mail_senden",
  description:
    "Sendet den offenen Mail-Entwurf nach Freigabe. Nur aufrufen, wenn der Nutzer klar „senden“ sagt (oder Dauerfreigabe + „senden“). Verbraucht bei Dauerfreigabe das Tageslimit erst hier.",
  parameters: {
    type: "object",
    properties: {
      bestaetigt: {
        type: "boolean",
        description: "Muss true sein – Nutzer hat den Versand ausdrücklich bestätigt.",
      },
    },
    required: ["bestaetigt"],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<NovaToolResult> {
    if (args.bestaetigt !== true) {
      return fail("Versand nicht bestätigt.");
    }
    try {
      const pending = await prisma.approvalRequest.findFirst({
        where: {
          organizationId: ctx.organizationId,
          status: "pending",
          actionType: { in: ["mail.send", "mail.send.batch"] },
        },
        orderBy: { createdAt: "desc" },
      });

      let communicationIds: string[] = [];
      let recipient: string | undefined;
      let approvalToken: string | undefined;

      if (pending) {
        const payload = JSON.parse(pending.payload || "{}") as {
          communicationIds?: string[];
          to?: string;
        };
        communicationIds = payload.communicationIds ?? [];
        recipient = typeof payload.to === "string" ? payload.to : undefined;
        await decideApproval({
          organizationId: ctx.organizationId,
          approvalId: pending.id,
          status: "approved",
        });
        approvalToken = pending.id;
      } else {
        const draft = await prisma.communication.findFirst({
          where: {
            organizationId: ctx.organizationId,
            deliveryStatus: "WAITING_FOR_APPROVAL",
            status: { not: "sent" },
          },
          orderBy: { updatedAt: "desc" },
          include: { contact: true },
        });
        if (!draft) {
          return fail("Es liegt kein Versand zur Freigabe vor. Es wurde nichts gesendet.");
        }
        communicationIds = [draft.id];
        recipient = draft.contact?.email ?? undefined;
      }

      if (!communicationIds.length) {
        return fail("Kein Entwurf in der Freigabe.");
      }

      const domain = recipient?.includes("@") ? recipient.split("@").pop() : undefined;
      const auth = await authorizeExternalAction({
        organizationId: ctx.organizationId,
        actionType: "mail.send",
        description: "Mail versenden",
        jobId: ctx.jobId,
        approvalToken,
        payload: { communicationIds, to: recipient },
        riskLevel: "external",
        requiresApproval: true,
        conditions: domain ? { recipientDomain: domain } : undefined,
      });

      if (auth.decision === "deny_hard") {
        return fail(auth.reason);
      }
      if (auth.decision === "need_approval") {
        return fail("Für den Versand fehlt noch eine Freigabe.");
      }

      let verified = 0;
      const reasons: string[] = [];
      for (const communicationId of communicationIds) {
        const result = await deliverApprovedDraft({
          organizationId: ctx.organizationId,
          communicationId,
          approved: true,
          fallbackTo: recipient,
        });
        reasons.push(result.reason);
        if (result.status === "VERIFIED") verified += 1;
      }

      if (!verified) {
        return {
          ok: false,
          executed: false,
          error: reasons.filter(Boolean).join(" ") || "Versand nicht bestätigt.",
          data: { verified: 0 },
        };
      }

      return ok(
        {
          verified,
          message:
            verified === 1
              ? "Die Mail ist versendet und liegt in Apple Mail unter Gesendet."
              : `${verified} Mails sind versendet und bestätigt.`,
        },
        true,
      );
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Senden fehlgeschlagen.");
    }
  },
};

export const vorlageListeTool: NovaToolDefinition = {
  name: "vorlage_liste",
  description: "Listet Mail-Vorlagen aus ~/Nova/vorlagen/*.md und importiert sie in die Datenbank.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  async execute(_args, ctx): Promise<NovaToolResult> {
    try {
      const files = listeVorlagenDateien();
      const imported = await importVorlagenInDb(ctx.organizationId);
      return ok({
        vorlagen: files.map((f) => ({ name: f.name, dateiname: f.dateiname })),
        imported,
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Vorlagen listen fehlgeschlagen.");
    }
  },
};

export const vorlageFuellenTool: NovaToolDefinition = {
  name: "vorlage_fuellen",
  description:
    "Füllt eine Vorlage aus ~/Nova/vorlagen mit Platzhaltern (anrede, firma, vorname, nachname, ansprechpartner, projekt, rolle).",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Dateiname ohne .md" },
      anrede: { type: "string" },
      firma: { type: "string" },
      vorname: { type: "string" },
      nachname: { type: "string" },
      ansprechpartner: { type: "string", description: "Falls gesetzt, wird als vorname genutzt." },
      projekt: { type: "string" },
      rolle: { type: "string" },
    },
    required: ["name", "anrede", "firma", "vorname", "nachname", "ansprechpartner", "projekt", "rolle"],
    additionalProperties: false,
  },
  async execute(args): Promise<NovaToolResult> {
    try {
      const name = String(args.name ?? "");
      const vorname =
        String(args.vorname ?? "").trim() ||
        String(args.ansprechpartner ?? "").trim();
      const filled = fuelleVorlage(name, {
        anrede: String(args.anrede ?? ""),
        firma: String(args.firma ?? ""),
        vorname,
        nachname: String(args.nachname ?? ""),
        projekt: String(args.projekt ?? ""),
        rolle: String(args.rolle ?? ""),
      });
      return ok(filled);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Vorlage füllen fehlgeschlagen.");
    }
  },
};

export const freigabeMailDauerTool: NovaToolDefinition = {
  name: "freigabe_mail_dauer",
  description:
    "Erteilt oder speichert die Dauerfreigabe „Mail senden“, wenn der Nutzer das ausdrücklich sagt (z. B. „Du darfst ab jetzt Mails senden, wenn ich senden sage“).",
  parameters: {
    type: "object",
    properties: {
      erteilen: {
        type: "boolean",
        description: "true = Dauerfreigabe speichern.",
      },
    },
    required: ["erteilen"],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<NovaToolResult> {
    if (args.erteilen !== true) {
      return fail("Dauerfreigabe nicht erteilt.");
    }
    try {
      const policy = await createStandingPolicy({
        organizationId: ctx.organizationId,
        name: "Mails senden (auf „senden“)",
        actionType: "mail.send.batch",
        limits: { maxPerDay: 40 },
        conditions: {},
      });
      return ok({
        policyId: policy.id,
        message:
          "Dauerfreigabe gespeichert: Wenn du „senden“ sagst, darf ich Mails versenden (Tageslimit gilt).",
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Dauerfreigabe fehlgeschlagen.");
    }
  },
};

export const MAIL_TOOLS: NovaToolDefinition[] = [
  mailLesenTool,
  mailEntwurfTool,
  mailAntwortenTool,
  mailSendenTool,
  vorlageListeTool,
  vorlageFuellenTool,
  freigabeMailDauerTool,
];
