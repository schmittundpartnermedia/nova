import { prepareTextForSpeech } from "@/services/voice/prepare-text";
import { nextUnspokenChunks, splitSpeechChunks } from "@/services/voice/chunk-text";
import { inferSpeechEmotion } from "@/services/voice/emotion";
import { classifyVisemeFromBands } from "@/services/voice/viseme-heuristic";
import { NOVA_VOICE_CONFIG } from "@/providers/voice/config";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main() {
  const original = "Hallo Joachim. Siehe https://rankpilot.de und ```js\nconsole.log(1)\n``` danke.";
  const spoken = prepareTextForSpeech(original);
  assert(original.includes("```js"), "Originaltext darf nicht mutiert werden.");
  assert(!spoken.includes("```"), "Codeblöcke dürfen nicht vorgelesen werden.");
  assert(!spoken.includes("https://"), "URLs dürfen nicht vollständig vorgelesen werden.");
  assert(spoken.includes("Rank Pilot") || spoken.includes("rankpilot.de") || spoken.includes("Link"), "Links müssen sprachgerecht ersetzt werden.");

  const ranked = prepareTextForSpeech("Für rankPilot sollten wir den nächsten Schritt vorbereiten.");
  assert(ranked.includes("Rank Pilot"), `rankPilot muss ausgesprochen werden, war: ${ranked}`);

  const secret = prepareTextForSpeech("Key sk-abcdefghijklmnopqrstuvwxyz 1234");
  assert(!secret.includes("sk-abcdefghijklmnopqrstuvwxyz"), "Secrets dürfen nicht in Speech.");

  const list = prepareTextForSpeech(
    ["Liste:", "- eins", "- zwei", "- drei", "- vier", "- fünf", "- sechs", "- sieben"].join("\n"),
  );
  assert(list.includes("Weitere Punkte stehen im Text."), `Lange Listen kürzen, war: ${list}`);

  const chunks = splitSpeechChunks(
    "Hallo Joachim. Ich bin NOVA. Was kann ich für dich tun?",
  );
  assert(chunks.length >= 2, `Erwartete mehrere Sätze, war ${chunks.length}: ${JSON.stringify(chunks)}`);
  assert(
    chunks.every((chunk) => !chunk.includes("Hallo Joachim. Ich bin NOVA.") || chunk.startsWith("Hallo")),
    "Keine doppelten Satzfragmente.",
  );

  const abbr = splitSpeechChunks("Wir prüfen z.B. die offenen Projekte und danach die Aufgaben.");
  assert(abbr.length === 1, `Abkürzungen nicht als Satzende, war ${JSON.stringify(abbr)}`);

  let spokenChars = 0;
  const streamA = nextUnspokenChunks({
    preparedText: "Hallo Joachim. Ich bin NOVA",
    spokenChars,
    finalize: false,
  });
  assert(streamA.chunks.join(" ").includes("Hallo Joachim"), "Erster Satz im Stream.");
  assert(!streamA.chunks.join(" ").includes("Ich bin NOVA"), "Unvollständiger Satz wird nicht gesprochen.");
  spokenChars = streamA.spokenChars;
  const streamB = nextUnspokenChunks({
    preparedText: "Hallo Joachim. Ich bin NOVA. Was kann ich für dich tun?",
    spokenChars,
    finalize: true,
  });
  assert(streamB.chunks.join(" ").includes("NOVA"), "Rest nach Stream-Ende.");
  assert(!streamB.chunks.some((chunk) => chunk.includes("Hallo Joachim")), "Kein doppeltes erstes Chunk.");

  const rest = classifyVisemeFromBands({
    rms: 0.01,
    bands: { bass: 0, low: 0, mid: 0, high: 0, sibilant: 0 },
    previous: "A",
    intensity: 0,
  });
  assert(rest === "REST", `Stille muss REST sein, war ${rest}`);

  const sibilant = classifyVisemeFromBands({
    rms: 0.2,
    bands: { bass: 0.05, low: 0.05, mid: 0.1, high: 0.2, sibilant: 0.7 },
    previous: "REST",
    intensity: 0.4,
  });
  assert(sibilant === "S_Z" || sibilant === "SH_CH", `Sibilant-Heuristik, war ${sibilant}`);

  const openA = classifyVisemeFromBands({
    rms: 0.45,
    bands: { bass: 0.7, low: 0.2, mid: 0.1, high: 0.05, sibilant: 0.02 },
    previous: "REST",
    intensity: 0.7,
  });
  assert(openA === "A", `Offener Vokal sollte A sein, war ${openA}`);

  assert(inferSpeechEmotion("Leider ist das nicht möglich.") === "concerned", "Concerned Emotion");
  assert(inferSpeechEmotion("Das freut mich.") === "positive", "Positive Emotion");
  assert(inferSpeechEmotion("Hallo Joachim. Ich bin NOVA.") === null, "Keine erfundene Emotion");

  assert(NOVA_VOICE_CONFIG.voice === "coral", "Zentrale Stimme");
  assert(NOVA_VOICE_CONFIG.model.includes("tts"), "TTS-Modell zentral");

  console.log(
    JSON.stringify(
      {
        ok: true,
        voice: NOVA_VOICE_CONFIG.voice,
        model: NOVA_VOICE_CONFIG.model,
        chunks,
        visemes: { rest, sibilant, openA },
      },
      null,
      2,
    ),
  );
}

main();
