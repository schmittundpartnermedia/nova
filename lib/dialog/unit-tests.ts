import assert from "node:assert/strict";
import { detectDialogMove, isPureSocial } from "@/lib/dialog/intent";
import { needsFlagshipModel, needsSpecialistWork } from "@/agents/master/intent";
import { needsLiveResearch } from "@/lib/research/intent";
import { detectKnowledgeIntent } from "@/agents/knowledge/intent";

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

  return failures;
}
