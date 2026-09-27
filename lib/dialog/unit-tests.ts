import assert from "node:assert/strict";
import { detectDialogMove, isPureSocial } from "@/lib/dialog/intent";
import { detectUserTone } from "@/lib/dialog/tone";
import { needsFlagshipModel, needsSpecialistWork } from "@/agents/master/intent";
import { needsLiveResearch } from "@/lib/research/intent";
import { detectKnowledgeIntent } from "@/agents/knowledge/intent";
import { approvalSupersedesReview, classifySituationTurn } from "@/lib/dialog/situation";
import { classifyConversationMove } from "@/lib/dialog/followup";
import { detectProjectIntent } from "@/agents/projects/intent";
import { nextDraftBody } from "@/lib/mail/revise";
import { detectCodingIntent } from "@/agents/coding/intent";
import { detectMailIntent } from "@/lib/mail/intent";

export function runDialogUnitTests(): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : "fail"}`);
    }
  };

  check("feierabend is social wish", () => {
    assert.equal(detectDialogMove("Schönen Feierabend").kind, "social");
    assert.equal(detectDialogMove("Schönen Feierabend").act, "wish");
    assert.equal(detectDialogMove("NOVA, ich wünsche dir einen schönen Feierabend.").kind, "social");
    assert.equal(isPureSocial("Schönen Feierabend"), true);
  });

  check("thanks greeting farewell", () => {
    assert.equal(detectDialogMove("Danke").kind, "social");
    assert.equal(detectDialogMove("Danke").act, "thanks");
    assert.equal(detectDialogMove("Hallo").kind, "social");
    assert.equal(detectDialogMove("Tschüss").kind, "social");
    assert.equal(detectDialogMove("Alles klar.").kind, "social");
  });

  check("definition question is not a wish", () => {
    assert.equal(detectDialogMove("Was bedeutet Feierabend?").kind, "ask");
    assert.equal(isPureSocial("Was bedeutet Feierabend?"), false);
  });

  check("knowledge questions stay questions", () => {
    assert.equal(detectDialogMove("Was stand im Angebot von Firma Nordstern?").kind, "ask");
    assert.equal(detectKnowledgeIntent("Was stand im Angebot von Firma Nordstern?").kind, "query");
    assert.equal(isPureSocial("Was stand im Angebot von Firma Nordstern?"), false);
  });

  check("mixed social plus question", () => {
    const move = detectDialogMove("Schönen Feierabend, was stand im Angebot zum Preis?");
    assert.equal(move.kind, "ask");
    assert.equal(move.socialAck, true);
  });

  check("social never routes to specialist or live research", () => {
    assert.equal(needsSpecialistWork("Schönen Feierabend"), false);
    assert.equal(needsSpecialistWork("Danke"), false);
    assert.equal(needsLiveResearch("Schönen Feierabend"), false);
    assert.equal(needsLiveResearch("Hallo NOVA"), false);
  });

  check("work and research still specialist", () => {
    assert.equal(needsSpecialistWork("Finde aktuelle Unternehmen, die als Sponsor passen."), true);
    assert.equal(needsSpecialistWork("Merk dir: Hetzner startet mit drei Monaten Pilot."), true);
    assert.equal(needsSpecialistWork("Hallo NOVA, wie ist der Stand?"), false);
    assert.equal(needsSpecialistWork("Was steht an?"), true);
    assert.equal(needsSpecialistWork("Lege morgen um 10 Uhr einen Termin an"), true);
    assert.equal(needsSpecialistWork("Speicher Kontakt Clara"), true);
  });

  check("tone beyond greetings", () => {
    assert.equal(detectUserTone("Na super, schon wieder."), "sarcastic");
    assert.equal(detectUserTone("Jetzt reicht's."), "annoyed");
    assert.equal(detectUserTone("Nur Spaß haha"), "playful");
    assert.equal(detectUserTone("Ich bin müde, später."), "tired");
    assert.equal(detectUserTone("Das braucht ich sofort."), "urgent");
    assert.equal(detectUserTone("Was stand im Angebot?"), "neutral");
  });

  check("flagship only for hard work", () => {
    assert.equal(needsFlagshipModel("Schönen Feierabend"), false);
    assert.equal(needsFlagshipModel("Was stand im Angebot von Firma Nordstern?"), false);
    assert.equal(needsFlagshipModel("Merk dir: Hetzner startet mit drei Monaten Pilot."), false);
    assert.equal(needsFlagshipModel("Aendere die Startseite von rankPilot"), true);
    assert.equal(needsFlagshipModel("Bau eine Website für Testkunde"), true);
    assert.equal(needsFlagshipModel("Finde aktuelle Unternehmen, die als Sponsor passen."), true);
    assert.equal(needsFlagshipModel("Wer ist derzeit Bundeskanzler?"), false);
  });

  check("situation binds short answers to open work", () => {
    const idle = {
      pendingApproval: null,
      approvalCreatedAt: null,
      reviewOpenedAt: null,
      activeReview: false,
      resumableComputer: false,
      lastActivityType: null,
    };
    assert.equal(classifySituationTurn("Ja", idle).kind, "none");
    assert.equal(classifySituationTurn("Wie ist der Stand?", idle).kind, "status");
    assert.equal(classifySituationTurn("Was ist der aktuelle Stand?", idle).kind, "status");
    assert.equal(classifySituationTurn("Was ist der aktuelle Preis?", idle).kind, "none");
    assert.equal(classifySituationTurn("Stopp", idle).kind, "cancel-active");
    assert.equal(
      classifySituationTurn("Ja", { ...idle, pendingApproval: { actionType: "mail.send", hardBlocked: false } }).kind,
      "confirm-pending",
    );
    assert.equal(
      classifySituationTurn("Nein", { ...idle, pendingApproval: { actionType: "mail.send", hardBlocked: false } }).kind,
      "reject-pending",
    );
    assert.equal(
      classifySituationTurn("Nicht jetzt.", { ...idle, pendingApproval: { actionType: "mail.send", hardBlocked: false } }).kind,
      "reject-pending",
    );
    assert.equal(classifySituationTurn("Was ist dein aktueller Status?", idle).kind, "status");
    assert.equal(
      classifySituationTurn("Ändere den Entwurf, schreib dass ich nächste Woche schaue.", { ...idle, activeReview: true }).kind,
      "revise-mail",
    );
    const reviewAt = new Date("2026-09-26T12:00:00Z");
    const approvalAt = new Date("2026-09-26T12:05:00Z");
    assert.equal(
      approvalSupersedesReview({ approvalAt, reviewAt, confirmsApproval: true }),
      true,
    );
    assert.equal(
      approvalSupersedesReview({ approvalAt: reviewAt, reviewAt: approvalAt, confirmsApproval: true }),
      false,
    );
  });

  check("follow-ups stay on the open turn and fresh work does not", () => {
    assert.equal(classifyConversationMove("warum nicht?"), "continue");
    assert.equal(classifyConversationMove("welche davon?"), "continue");
    assert.equal(classifyConversationMove("mach das"), "continue");
    assert.equal(classifyConversationMove("die andere"), "continue");
    assert.equal(classifyConversationMove("und dann?"), "continue");
    assert.equal(classifyConversationMove("wo waren wir?"), "return");
    assert.equal(classifyConversationMove("zurück zu den Kontakten von eben"), "return");
    assert.equal(classifyConversationMove("Lies die neuesten Mails."), "fresh");
    assert.equal(classifyConversationMove("Hallo"), "fresh");
    assert.equal(classifyConversationMove("Was steht an?"), "fresh");
  });

  check("project name drops the trailing verb particle", () => {
    const intent = detectProjectIntent("Lege ein Projekt NOVA-Auditprobe an.");
    assert.equal(intent.kind, "create");
    if (intent.kind === "create") assert.equal(intent.name, "NOVA-Auditprobe");
  });

  check("draft revision keeps the same text unless a change is stated", () => {
    const current = "An: audit@example.com\n\nGuten Tag,\n\nDies ist ein Testentwurf.\n\nFreundliche Grüße";
    assert.equal(nextDraftBody(current, "Ändere den Entwurf.").changed, false);
    const changed = nextDraftBody(current, "Ändere den Entwurf, schreib dass ich nächste Woche schaue.");
    assert.equal(changed.changed, true);
    assert.match(changed.body, /nächste Woche/);
    assert.match(changed.body, /audit@example.com/);
  });

  check("addressing nova is not a coding project", () => {
    assert.equal(detectCodingIntent("NOVA, ändere den Entwurf").kind, "none");
    assert.equal(detectCodingIntent("Ändere die Startseite von rankPilot").kind, "implement");
  });

  check("mail word alone is not a mailbox search", () => {
    assert.equal(detectMailIntent("Erkläre mir das Mailkonzept").kind, "none");
    assert.equal(detectMailIntent("Such die Mail von Hetzner").kind, "search");
    const linkedin = detectMailIntent("Finde Mails von LinkedIn");
    assert.equal(linkedin.kind, "search");
    if (linkedin.kind === "search") assert.equal(linkedin.query, "LinkedIn");
    const postfach = detectMailIntent("Suche im Postfach nach LinkedIn");
    assert.equal(postfach.kind, "search");
    if (postfach.kind === "search") assert.match(postfach.query, /LinkedIn/);
    assert.equal(detectMailIntent("Gibt es neue wichtige Mails?").kind, "inbox");
  });

  return failures;
}
