/**
 * Regressionstest für den Kopf (Phase 1) – ohne Netz, ohne App, ohne Bildschirm.
 * Das Modell wird durch ein Skript ersetzt, das pro Test festlegt, was „das Modell“ antwortet.
 * Geprüft wird, was NOVA daraus macht: Verlauf und Gedächtnis gehen mit, Werkzeuge laufen,
 * Ergebnisse gehen zurück an das Modell, und am Ende steht eine ehrliche Antwort.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runHeadLoop } from "@/agents/master/head";
import { lesenGedaechtnis } from "@/lib/gedaechtnis/store";
import { gedaechtnisDir } from "@/lib/gedaechtnis/paths";
import { listTools } from "@/services/tools/registry";
import type { HeadProvider, HeadTurnInput, HeadTurnOutput } from "@/types/ai";

type Step = Omit<HeadTurnOutput, "model" | "provider" | "responseId">;

/** Geskriptetes Modell: gibt die Schritte der Reihe nach zurück und merkt sich jede Eingabe. */
function scripted(steps: Step[]): HeadProvider & { calls: HeadTurnInput[] } {
  const calls: HeadTurnInput[] = [];
  let index = 0;
  return {
    id: "skript",
    calls,
    async headTurn(input) {
      calls.push(structuredClone(input));
      const step = steps[index];
      index += 1;
      if (!step) throw new Error(`Skript hat keinen Schritt ${index}.`);
      return { ...step, responseId: `resp-${index}`, model: "skript-modell", provider: "skript" };
    },
    async healthCheck() {
      return { ok: true, provider: "skript", message: "Skript" };
    },
  };
}

const tests: Array<[string, () => Promise<void>]> = [];
function test(name: string, fn: () => Promise<void>) {
  tests.push([name, fn]);
}

test("Werkzeugliste enthält in Phase 1 nur die Gedächtnis-Werkzeuge", async () => {
  assert.deepEqual(
    listTools().map((t) => t.name).sort(),
    ["gedaechtnis_lesen", "gedaechtnis_schreiben"],
  );
});

test("„Merk dir …“: Werkzeug schreibt in firma.md, Ergebnis geht an das Modell zurück", async () => {
  const fakt = "Wir suchen Sponsoren aus dem Handwerk in Baden-Württemberg.";
  const model = scripted([
    {
      text: "",
      toolCalls: [
        { callId: "c1", name: "gedaechtnis_schreiben", arguments: { datei: "firma", inhalt: fakt, modus: "ergaenzen" } },
      ],
    },
    { text: "Gemerkt.", toolCalls: [] },
  ]);
  const result = await runHeadLoop({ provider: model, model: "m", history: [], userRequest: `Merk dir: ${fakt}` });

  assert.ok(lesenGedaechtnis("firma").includes(fakt), "firma.md enthält den Fakt nicht");
  assert.deepEqual(result.toolsExecuted, [{ name: "gedaechtnis_schreiben", executed: true }]);
  assert.equal(result.reply, "Gemerkt.");
  assert.equal(result.toolRounds, 1);

  const zweiter = model.calls[1]!;
  assert.equal(zweiter.previousResponseId, "resp-1", "Folgeschritt muss an die vorherige Antwort anknüpfen");
  assert.equal(zweiter.input.length, 1);
  const output = zweiter.input[0] as { type: string; call_id: string; output: string };
  assert.equal(output.type, "function_call_output");
  assert.equal(output.call_id, "c1");
  assert.equal(JSON.parse(output.output).ok, true);
});

test("Dauergedächtnis steht bei jeder Anfrage in den Anweisungen", async () => {
  const model = scripted([{ text: "Handwerk in BW.", toolCalls: [] }]);
  await runHeadLoop({ provider: model, model: "m", history: [], userRequest: "Was suchen wir nochmal?" });
  const instructions = model.calls[0]!.instructions;
  assert.ok(instructions.includes("Baden-Württemberg"), "Gedächtnisinhalt fehlt in den Anweisungen");
  assert.ok(instructions.includes("### firma.md") && instructions.includes("### kunden.md") && instructions.includes("### projekte.md"));
});

test("Gesprächsverlauf geht vollständig und in Reihenfolge vor dem neuen Satz mit", async () => {
  const history = [
    { role: "user" as const, content: "Was für Sponsoren passen zu uns?" },
    { role: "assistant" as const, content: "Elektriker und Dachdecker aus BW." },
  ];
  const model = scripted([{ text: "Weil sie lokal Kunden gewinnen.", toolCalls: [] }]);
  const result = await runHeadLoop({ provider: model, model: "m", history, userRequest: "Und warum die?" });
  assert.deepEqual(model.calls[0]!.input, [...history, { role: "user", content: "Und warum die?" }]);
  assert.equal(model.calls[0]!.previousResponseId, undefined);
  assert.equal(result.reply, "Weil sie lokal Kunden gewinnen.");
});

test("Unbekanntes Werkzeug: Fehler geht ans Modell, nichts gilt als ausgeführt", async () => {
  const model = scripted([
    { text: "", toolCalls: [{ callId: "x", name: "mail_senden", arguments: {} }] },
    { text: "Das kann ich noch nicht.", toolCalls: [] },
  ]);
  const result = await runHeadLoop({ provider: model, model: "m", history: [], userRequest: "Schick die Mail." });
  assert.deepEqual(result.toolsExecuted, [{ name: "mail_senden", executed: false }]);
  const output = JSON.parse((model.calls[1]!.input[0] as { output: string }).output);
  assert.equal(output.ok, false);
  assert.match(output.error, /Unbekanntes Werkzeug/);
});

test("Lesen zählt nicht als ausgeführte Aktion", async () => {
  const model = scripted([
    { text: "", toolCalls: [{ callId: "r", name: "gedaechtnis_lesen", arguments: { datei: "firma" } }] },
    { text: "Steht drin.", toolCalls: [] },
  ]);
  const result = await runHeadLoop({ provider: model, model: "m", history: [], userRequest: "Lies firma." });
  assert.deepEqual(result.toolsExecuted, [{ name: "gedaechtnis_lesen", executed: false }]);
});

test("Werkzeugrunden erschöpft: ehrliche Meldung statt „Erledigt“", async () => {
  const endlos: Step = { text: "", toolCalls: [{ callId: "r", name: "gedaechtnis_lesen", arguments: { datei: "firma" } }] };
  const model = scripted(Array.from({ length: 20 }, () => endlos));
  const result = await runHeadLoop({ provider: model, model: "m", history: [], userRequest: "Mach irgendwas." });
  assert.match(result.reply, /nicht zu einem Ergebnis gekommen/);
  assert.equal(model.calls.length, 8);
});

test("Leere Modellantwort wird nicht als Erfolg ausgegeben", async () => {
  const model = scripted([{ text: "  ", toolCalls: [] }]);
  const result = await runHeadLoop({ provider: model, model: "m", history: [], userRequest: "Hallo?" });
  assert.equal(result.reply, "Darauf habe ich gerade keine Antwort.");
});

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-kopf-"));
  process.env.NOVA_HOME = home;
  let failed = 0;
  try {
    for (const [name, fn] of tests) {
      try {
        await fn();
        console.log(`ok   ${name}`);
      } catch (error) {
        failed += 1;
        console.log(`FAIL ${name}`);
        console.log(error instanceof Error ? error.message : error);
      }
    }
    assert.ok(gedaechtnisDir().startsWith(home), "Test darf nicht in ~/Nova schreiben");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
  console.log(failed ? `${failed} von ${tests.length} fehlgeschlagen` : `alle ${tests.length} bestanden`);
  process.exit(failed ? 1 : 0);
}

void main();
