import assert from "node:assert/strict";
import { parseWhen, guessTitle } from "@/lib/calendar/when";
import { detectCalendarIntent } from "@/agents/calendar/intent";
import { detectWatchIntent } from "@/agents/watch/intent";
import { detectContactIntent } from "@/agents/contacts/intent";
import { detectTicketIntent } from "@/agents/tickets/intent";
import { needsSpecialistWork } from "@/agents/master/intent";
import { planComputerTask } from "@/agents/computer/planner";
import { detectComputerIntent } from "@/agents/computer/intent";
import { mentionsVolumeDisk } from "@/lib/computer/volumes";

export function runOpsUnitTests(): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : "fail"}`);
    }
  };

  check("parse morgen with time", () => {
    const now = new Date("2026-09-24T08:00:00");
    const when = parseWhen("Leg morgen um 10:00 einen Termin Hetzner Review an", now);
    assert.ok(when);
    assert.equal(when?.startsAt.getDate(), 25);
    assert.equal(when?.startsAt.getHours(), 10);
  });

  check("parse german date", () => {
    const when = parseWhen("Termin am 1.10.2026 um 14:30");
    assert.ok(when);
    assert.equal(when?.startsAt.getFullYear(), 2026);
    assert.equal(when?.startsAt.getMonth(), 9);
    assert.equal(when?.startsAt.getDate(), 1);
    assert.equal(when?.startsAt.getHours(), 14);
    assert.equal(when?.startsAt.getMinutes(), 30);
  });

  check("parse um 14 Uhr, not the date dots", () => {
    const when = parseWhen("Termin am 1.10.2026 um 14 Uhr");
    assert.ok(when);
    assert.equal(when?.startsAt.getHours(), 14);
    assert.equal(when?.startsAt.getMinutes(), 0);
  });

  check("no date is not invented", () => {
    assert.equal(parseWhen("Irgendwann ein Meeting"), null);
  });

  check("title strips commands", () => {
    assert.match(guessTitle("Lege morgen um 10 Uhr einen Termin Hetzner Review an"), /Hetzner Review/i);
  });

  check("calendar create intent", () => {
    assert.equal(detectCalendarIntent("Lege morgen um 10 Uhr einen Termin Hetzner Review an"), true);
    assert.equal(detectCalendarIntent("Welche Termine stehen an?"), true);
    assert.equal(detectCalendarIntent("Was steht an?"), false);
  });

  check("watch intent", () => {
    assert.equal(detectWatchIntent("Was steht an?"), true);
    assert.equal(detectWatchIntent("Was hatten wir zu ELEVUM beschlossen?"), false);
  });

  check("specialist routing", () => {
    assert.equal(needsSpecialistWork("Was steht an?"), true);
    assert.equal(needsSpecialistWork("Lege morgen um 10 Uhr einen Termin an"), true);
    assert.equal(needsSpecialistWork("Was hatten wir zu ELEVUM beschlossen?"), false);
    assert.equal(needsSpecialistWork("Speicher Kontakt Clara Hetzner"), true);
    assert.equal(needsSpecialistWork("Neues Ticket für Hetzner Rechnung"), true);
  });

  check("contact and ticket intent", () => {
    assert.equal(detectContactIntent("Speicher Kontakt Clara Hetzner"), "create");
    assert.equal(detectContactIntent("Speichere den Kontakt Probekette Nova."), "create");
    assert.equal(detectContactIntent("Wer ist Clara"), "search");
    assert.equal(detectTicketIntent("Neues Ticket für Hetzner Rechnung"), "create");
    assert.equal(detectTicketIntent("Welche Tickets habe ich?"), "list");
    assert.equal(detectTicketIntent("Was steht an?"), false);
  });

  check("ui click plans a self-check screenshot", () => {
    const steps = planComputerTask({
      kind: "ui_click",
      userRequest: "Klick auf Speichern in TextEdit",
      workspace: "/tmp",
    });
    assert.equal(steps.some((step) => step.tool === "screen"), true);
    assert.equal(steps.some((step) => step.tool === "accessibility" && (step.payload as { action?: string }).action === "inspect"), true);
    assert.equal(steps.some((step) => step.tool === "accessibility" && (step.payload as { action?: string }).action === "press"), true);
  });

  check("elevum is local disk, not google", () => {
    assert.equal(mentionsVolumeDisk("Was liegt auf ELEVUM?", "ELEVUM"), true);
    assert.equal(detectComputerIntent("Was liegt auf ELEVUM?").kind, "find_file");
    assert.equal(needsSpecialistWork("Was hatten wir zu ELEVUM beschlossen?"), false);
  });

  check("applescript tell finder is planned", () => {
    assert.equal(detectComputerIntent('Führe AppleScript aus: tell application "Finder" to get name').kind, "run_script");
    const steps = planComputerTask({
      kind: "run_script",
      userRequest: 'Führe AppleScript aus: tell application "Finder" to get name',
      workspace: "/tmp",
    });
    assert.equal(steps.some((step) => step.tool === "application"), true);
  });

  return failures;
}
