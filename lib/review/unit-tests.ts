import assert from "node:assert/strict";
import { classifyReviewUtterance } from "@/lib/review/intent";

export function runReviewUnitTests(): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  check("approve phrases", () => {
    assert.deepEqual(classifyReviewUtterance("Passt."), { kind: "approve", alsoSend: false });
    assert.deepEqual(classifyReviewUtterance("„Passt.“"), { kind: "approve", alsoSend: false });
    assert.deepEqual(classifyReviewUtterance("Freigeben."), { kind: "approve", alsoSend: false });
    assert.deepEqual(classifyReviewUtterance("Passt, senden"), { kind: "approve", alsoSend: true });
    assert.deepEqual(classifyReviewUtterance("Senden."), { kind: "approve", alsoSend: true });
    assert.deepEqual(classifyReviewUtterance("Weiter."), { kind: "continue" });
  });

  check("changes and cancel", () => {
    const change = classifyReviewUtterance("Ändere Szene 3.");
    assert.equal(change?.kind, "changes");
    assert.equal(classifyReviewUtterance("Nochmal.")?.kind, "changes");
    assert.equal(classifyReviewUtterance("Nicht gut.")?.kind, "changes");
    assert.equal(classifyReviewUtterance("Abbrechen.")?.kind, "cancel");
  });

  check("new task is not a review", () => {
    assert.equal(classifyReviewUtterance("Recherchiere ein Testthema und lege mir das Ergebnis ab."), null);
  });

  return failures;
}
