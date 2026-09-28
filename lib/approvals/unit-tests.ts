import assert from "node:assert/strict";
import {
  isIrreversibleAction,
  standingActionTypeFor,
  riskLevelFromComputerRisk,
} from "@/services/approvals/authorize";

export function runApprovalAuthorizeUnitTests(): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : "fail"}`);
    }
  };

  check("irreversible delete never standing-mapped as allow-by-default", () => {
    assert.equal(isIrreversibleAction("computer.filesystem.delete", "irreversible"), true);
    assert.equal(isIrreversibleAction("payment.charge", "external"), true);
    assert.equal(isIrreversibleAction("mail.send", "external"), false);
    assert.equal(isIrreversibleAction("mail.send", "irreversible"), true);
    assert.equal(standingActionTypeFor("computer.filesystem.delete"), null);
    // authorizeExternalAction setzt standingType bei irreversible immer auf null
    assert.equal(isIrreversibleAction("publish.site", "change"), true);
  });

  check("standing maps mail.send and ui click", () => {
    assert.equal(standingActionTypeFor("mail.send"), "mail.send.batch");
    assert.equal(standingActionTypeFor("macos.ui.click"), "macos.ui.click");
    assert.equal(standingActionTypeFor("computer.filesystem.delete"), null);
  });

  check("risk level mapping", () => {
    assert.equal(riskLevelFromComputerRisk("READ_ONLY"), "read");
    assert.equal(riskLevelFromComputerRisk("DESTRUCTIVE"), "irreversible");
    assert.equal(riskLevelFromComputerRisk("EXTERNAL_SIDE_EFFECT"), "external");
  });

  return failures;
}
