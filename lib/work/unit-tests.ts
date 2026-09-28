import assert from "node:assert/strict";
import { missingRequiredSlots, nextSlotQuestion } from "@/lib/work/slots";

export function runWorkUnitTests(): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : "fail"}`);
    }
  };

  check("calendar asks when first", () => {
    const missing = missingRequiredSlots("calendar", {});
    assert.deepEqual(missing, ["when", "title"]);
    assert.match(nextSlotQuestion("calendar", missing) ?? "", /Wann/);
  });

  check("calendar ready when slots filled", () => {
    assert.deepEqual(missingRequiredSlots("calendar", { when: "morgen 15 Uhr", title: "Call" }), []);
  });

  check("ticket needs title", () => {
    assert.deepEqual(missingRequiredSlots("ticket", {}), ["title"]);
  });

  return failures;
}
