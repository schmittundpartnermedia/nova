import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { isSteerableMailAddress, steerableMailAddresses } from "@/lib/mail/steerable";
import { authorizeExternalAction, decideApproval } from "@/services/approvals";
import { decodeMailRef, type Postfach } from "@/services/mail/postfach";

/**
 * Mail-Entwürfe (Communication, channel "email") und ihr Versand.
 * Ein Weg für Kopf und Hintergrund-Läufer: Entwurf → Freigabe prüfen → Apple Mail → in „Gesendet“ bestätigt.
 */

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export type Entwurf = {
  id: string;
  absender: string;
  an: string;
  betreff: string;
  text: string;
  antwortAuf: string | null;
  status: string;
  kampagneId: string | null;
  empfaengerName: string | null;
};

function toEntwurf(row: {
  id: string;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string;
  body: string;
  replyRef: string | null;
  status: string;
  campaignId: string | null;
  recipientName: string | null;
}): Entwurf {
  return {
    id: row.id,
    absender: row.fromAddress ?? "",
    an: row.toAddress ?? "",
    betreff: row.subject,
    text: row.body,
    antwortAuf: row.replyRef,
    status: row.status,
    kampagneId: row.campaignId,
    empfaengerName: row.recipientName,
  };
}

export async function erstelleEntwurf(input: {
  organizationId: string;
  absender: string;
  an: string;
  betreff: string;
  text: string;
  antwortAuf?: string;
  ersetzt?: string;
  kampagneId?: string;
  empfaengerName?: string;
}): Promise<Entwurf> {
  assertOrganizationId(input.organizationId);
  const absender = input.absender.trim().toLowerCase();
  const an = input.an.trim();
  if (!isSteerableMailAddress(absender)) {
    throw new Error(`Absender muss ${steerableMailAddresses().join(" oder ")} sein.`);
  }
  if (!EMAIL.test(an)) throw new Error(`Empfänger „${an}“ ist keine gültige Mail-Adresse.`);
  if (!input.betreff.trim()) throw new Error("Betreff fehlt.");
  if (!input.text.trim()) throw new Error("Text fehlt.");
  if (input.antwortAuf && !decodeMailRef(input.antwortAuf)) throw new Error("Bezug auf die Originalmail ist ungültig.");

  if (input.ersetzt) {
    await prisma.communication.updateMany({
      where: { id: input.ersetzt, organizationId: input.organizationId, status: "draft" },
      data: { status: "superseded" },
    });
  }

  const row = await prisma.communication.create({
    data: {
      organizationId: input.organizationId,
      channel: "email",
      direction: "outbound",
      subject: input.betreff.trim(),
      body: input.text.trim(),
      status: "draft",
      deliveryStatus: "PREPARED",
      fromAddress: absender,
      toAddress: an,
      replyRef: input.antwortAuf ?? null,
      campaignId: input.kampagneId ?? null,
      recipientName: input.empfaengerName ?? null,
    },
  });
  return toEntwurf(row);
}

export async function ladeEntwurf(organizationId: string, id: string): Promise<Entwurf | null> {
  assertOrganizationId(organizationId);
  const row = await prisma.communication.findFirst({ where: { id, organizationId, channel: "email" } });
  return row ? toEntwurf(row) : null;
}

export type VersandStatus =
  | { status: "gesendet"; executed: true; messageId: string; grund: string }
  | { status: "freigabe_noetig"; executed: false; freigabeId: string; grund: string }
  | { status: "fehlgeschlagen"; executed: false; grund: string };

/**
 * Versendet einen Entwurf.
 * `freigabeId`: die Freigabe, die der Nutzer für genau diesen Entwurf erteilt hat.
 * Ohne Einzelfreigabe greift nur eine Dauerfreigabe; sonst wird eine Freigabe angelegt und nichts gesendet.
 */
export async function sendeEntwurf(input: {
  organizationId: string;
  entwurfId: string;
  postfach: Postfach;
  freigabeId?: string;
  jobId?: string;
}): Promise<VersandStatus> {
  assertOrganizationId(input.organizationId);
  const entwurf = await ladeEntwurf(input.organizationId, input.entwurfId);
  if (!entwurf) return { status: "fehlgeschlagen", executed: false, grund: "Entwurf nicht gefunden." };
  if (entwurf.status === "sent") return { status: "fehlgeschlagen", executed: false, grund: "Dieser Entwurf ist schon gesendet." };
  if (entwurf.status !== "draft") {
    return { status: "fehlgeschlagen", executed: false, grund: "Dieser Entwurf ist durch einen neueren ersetzt." };
  }
  const zeile = await prisma.communication.findUniqueOrThrow({ where: { id: entwurf.id } });
  if (zeile.deliveryStatus === "SENDING") {
    // Ein früherer Versuch wurde mitten im Versand unterbrochen: nicht blind noch einmal senden.
    await prisma.communication.update({ where: { id: entwurf.id }, data: { deliveryStatus: "FAILED" } });
    return {
      status: "fehlgeschlagen",
      executed: false,
      grund: "Ein früherer Versandversuch wurde unterbrochen; ob die Mail raus ist, bitte im Ordner Gesendet prüfen.",
    };
  }

  let actionType = "mail.send";
  let approvalToken = input.freigabeId;
  if (entwurf.kampagneId) {
    // Kampagnen-Mails laufen nur über die eine Freigabe der Kampagne.
    const kampagne = await prisma.campaign.findFirst({
      where: { id: entwurf.kampagneId, organizationId: input.organizationId },
    });
    if (!kampagne || kampagne.status !== "laeuft" || !kampagne.approvalId) {
      return { status: "fehlgeschlagen", executed: false, grund: "Die Kampagne läuft nicht (nicht freigegeben oder abgebrochen)." };
    }
    actionType = "mail.campaign";
    approvalToken = kampagne.approvalId;
  } else if (input.freigabeId) {
    const pending = await prisma.approvalRequest.findFirst({
      where: { id: input.freigabeId, organizationId: input.organizationId, actionType: "mail.send", status: "pending" },
    });
    const payload = pending ? (JSON.parse(pending.payload || "{}") as { entwurfId?: string }) : {};
    if (!pending || payload.entwurfId !== entwurf.id) {
      return { status: "fehlgeschlagen", executed: false, grund: "Diese Freigabe gehört nicht zu diesem Entwurf." };
    }
    await decideApproval({ organizationId: input.organizationId, approvalId: pending.id, status: "approved" });
  }

  const auth = await authorizeExternalAction({
    organizationId: input.organizationId,
    actionType,
    description: `Mail von ${entwurf.absender} an ${entwurf.an}: ${entwurf.betreff}`,
    payload: { entwurfId: entwurf.id },
    approvalToken,
    riskLevel: "external",
    jobId: input.jobId,
    conditions: { recipientDomain: entwurf.an },
  });
  if (auth.decision === "need_approval" && entwurf.kampagneId) {
    return { status: "fehlgeschlagen", executed: false, grund: "Die Freigabe der Kampagne fehlt." };
  }
  if (auth.decision === "need_approval") {
    await prisma.communication.update({ where: { id: entwurf.id }, data: { deliveryStatus: "WAITING_FOR_APPROVAL" } });
    return { status: "freigabe_noetig", executed: false, freigabeId: auth.approvalId, grund: auth.reason };
  }
  if (auth.decision === "deny_hard") return { status: "fehlgeschlagen", executed: false, grund: auth.reason };

  await prisma.communication.update({ where: { id: entwurf.id }, data: { deliveryStatus: "SENDING" } });
  let ergebnis;
  try {
    ergebnis = entwurf.antwortAuf
      ? await input.postfach.antworten({
          absender: entwurf.absender,
          ref: entwurf.antwortAuf,
          an: entwurf.an,
          betreff: entwurf.betreff,
          text: entwurf.text,
        })
      : await input.postfach.senden({
          absender: entwurf.absender,
          an: entwurf.an,
          betreff: entwurf.betreff,
          text: entwurf.text,
        });
  } catch (error) {
    ergebnis = { ok: false as const, executed: false as const, grund: error instanceof Error ? error.message : "Versand fehlgeschlagen." };
  }

  if (!ergebnis.ok) {
    await prisma.communication.update({ where: { id: entwurf.id }, data: { deliveryStatus: "FAILED" } });
    return { status: "fehlgeschlagen", executed: false, grund: ergebnis.grund };
  }
  await prisma.communication.update({
    where: { id: entwurf.id },
    data: {
      status: "sent",
      deliveryStatus: "VERIFIED",
      sentAt: new Date(),
      externalReference: ergebnis.messageId,
    },
  });
  return { status: "gesendet", executed: true, messageId: ergebnis.messageId, grund: ergebnis.grund };
}
