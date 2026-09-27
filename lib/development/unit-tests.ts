import assert from "node:assert/strict";
import { detectDevelopmentIntent } from "@/lib/development/intent";
import { buildCursorCommission, draftDevelopmentOrder, mapCodingOutcome } from "@/lib/development/brief";
import { formatDevelopmentStatusReply, summarizeCursorGoal } from "@/lib/development/status-text";

export function runDevelopmentUnitTests(): string[] {
  const failures: string[] = [];
  const check = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : "fail"}`);
    }
  };

  check("vision becomes a commission", () => {
    const intent = detectDevelopmentIntent(
      "NOVA, ich möchte, dass du künftig meine wichtigen E-Mails erkennst und mich nur bei relevanten Dingen informierst.",
    );
    assert.equal(intent.kind, "commission");
    assert.equal(detectDevelopmentIntent("Lies meine neuesten E-Mails.").kind, "none");
    assert.equal(detectDevelopmentIntent("Was baut Cursor gerade?").kind, "status");
    assert.equal(detectDevelopmentIntent("Woran arbeitet Cursor gerade?").kind, "status");
    assert.equal(detectDevelopmentIntent("Wie ist der Stand deiner Entwicklungsaufträge?").kind, "status");
    assert.equal(detectDevelopmentIntent("Wie ist der aktuelle Stand meines Entwicklungsauftrags?").kind, "status");
    assert.equal(detectDevelopmentIntent("Wie ist der Entwicklungsstand?").kind, "status");
    assert.equal(detectDevelopmentIntent("Und die geplanten Aufträge?").kind, "status");
    assert.equal(detectDevelopmentIntent("Für Hetzner ist ein Auftrag geplant.").kind, "none");
    assert.equal(
      detectDevelopmentIntent(
        "NOVA, ich möchte, dass du mir künftig sagen kannst, woran Cursor gerade für dich arbeitet und wie der aktuelle Stand deiner Entwicklungsaufträge ist.",
      ).kind,
      "commission",
    );
  });

  check("cursor brief keeps the wish and does not prescribe files", () => {
    const wish = "Ich möchte, dass du meinen Kalender bedienen kannst.";
    const draft = draftDevelopmentOrder(wish, "Coding Agent ist vorhanden.");
    const brief = buildCursorCommission({
      userRequest: wish,
      draft,
      existingCapabilities: "Coding Agent ist vorhanden.",
      previousFinding: "Tests rot",
    });
    assert.match(brief, /Ursprünglicher Wunsch: Ich möchte, dass du meinen Kalender bedienen kannst/);
    assert.match(brief, /Untersuche das Repository selbst/);
    assert.equal(/lege die datei|in der datei |klasse \w+ anlegen/i.test(brief), false);
    assert.match(brief, /Tests rot/);
    assert.equal(draft.goal, wish);
  });

  check("only a verified run waits for review", () => {
    assert.equal(mapCodingOutcome({ verified: true, status: "VERIFIED", summary: "ok", iteration: 0, maxIterations: 2 }), "waiting_review");
    assert.equal(
      mapCodingOutcome({ verified: false, status: "FAILED", summary: "Cursor Agent CLI ist nicht angemeldet.", iteration: 0, maxIterations: 2 }),
      "blocked",
    );
    assert.equal(
      mapCodingOutcome({
        verified: false,
        status: "FAILED",
        summary: "Pfad liegt außerhalb erlaubter Arbeitsverzeichnisse: /tmp/x",
        iteration: 0,
        maxIterations: 2,
      }),
      "blocked",
    );
    assert.equal(mapCodingOutcome({ verified: false, status: "UNVERIFIED", summary: "Build rot", iteration: 0, maxIterations: 2 }), "developing");
    assert.equal(mapCodingOutcome({ verified: false, status: "UNVERIFIED", summary: "Build rot", iteration: 1, maxIterations: 2 }), "failed");
  });

  check("status reply names cursor work and orders", () => {
    const prompt = [
      "Entwicklungsauftrag von NOVA.",
      "",
      "Ursprünglicher Wunsch: Bitte baue die Statusantwort.",
      "",
      "Ziel: Bitte baue die Statusantwort.",
    ].join("\n");
    assert.equal(summarizeCursorGoal(prompt), "Bitte baue die Statusantwort.");
    const formatted = formatDevelopmentStatusReply({
      userRequest: "Woran arbeitet Cursor gerade?",
      cursorWork: [
        {
          status: "RUNNING",
          projectPath: "/tmp/demo",
          goal: summarizeCursorGoal(prompt),
        },
      ],
      orders: [
        {
          status: "developing",
          goal: "Bitte baue die Statusantwort.",
          iteration: 0,
          maxIterations: 2,
          resultSummary: "Cursor läuft.",
        },
      ],
    });
    assert.match(formatted.reply, /Woran Cursor gerade für mich arbeitet/);
    assert.match(formatted.reply, /RUNNING: Bitte baue die Statusantwort/);
    assert.match(formatted.reply, /Aktueller Entwicklungsauftrag/);
    assert.match(formatted.reply, /developing: Bitte baue die Statusantwort/);
    assert.match(formatted.statusMessage, /Entwicklung: RUNNING/);
    const planned = formatDevelopmentStatusReply({
      userRequest: "Und die geplanten Aufträge?",
      cursorWork: [],
      orders: [
        { status: "completed", goal: "Erledigt.", iteration: 0, maxIterations: 2 },
        { status: "planned", goal: "Kalender bedienen.", iteration: 0, maxIterations: 2 },
      ],
    });
    assert.match(planned.reply, /Geplanter Auftrag, noch nicht gestartet/);
    assert.match(planned.reply, /Kalender bedienen/);
  });

  return failures;
}
