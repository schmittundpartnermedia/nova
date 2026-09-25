import assert from "node:assert/strict";
import { backoffMs, decideExternalEffect } from "@/lib/worker/policy";

export function runWorkerUnitTests(): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  check("backoff", () => {
    assert.equal(backoffMs(1, 1000, 60_000), 1000);
    assert.equal(backoffMs(2, 1000, 60_000), 2000);
    assert.equal(backoffMs(3, 1000, 60_000), 4000);
    assert.equal(backoffMs(20, 1000, 60_000), 60_000);
  });

  check("external effect decisions", () => {
    assert.equal(decideExternalEffect(null), "proceed");
    assert.equal(decideExternalEffect({ status: "committed" }), "already_committed");
    assert.equal(decideExternalEffect({ status: "intent" }), "needs_verification");
    assert.equal(decideExternalEffect({ status: "uncertain" }), "needs_verification");
  });

  return failures;
}
