import assert from "node:assert/strict";
import { cosineSimilarity, LocalHashEmbeddingProvider } from "@/providers/embedding";
import { classifyMemoryWorth, extractSpokenMemory, shouldPersistMemoryItem } from "@/lib/memory/policy";
import { parseEmbedding, serializeEmbedding, embeddingSimilarity, lexicalMemoryScore } from "@/lib/memory/embedding";

export async function runMemoryUnitTests(): Promise<string[]> {
  const failures: string[] = [];
  const check = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : "fail"}`);
    }
  };

  await check("smalltalk is not durable memory", () => {
    assert.equal(classifyMemoryWorth("Danke"), "skip");
    assert.equal(classifyMemoryWorth("Schönen Feierabend"), "skip");
    assert.equal(extractSpokenMemory("Hallo NOVA"), null);
    assert.equal(shouldPersistMemoryItem({ title: "Danke", content: "Gerne." }), false);
  });

  await check("secrets never persist", () => {
    assert.equal(classifyMemoryWorth("OPENAI_API_KEY=sk-secret-abc"), "secret");
    assert.equal(shouldPersistMemoryItem({ title: "Key", content: "sk-secret-abc12345" }), false);
  });

  await check("spoken decisions persist without merk dir", () => {
    const spoken = extractSpokenMemory("Wir haben beschlossen, Hetzner drei Monate zu testen.");
    assert.ok(spoken);
    assert.equal(spoken?.type, "decision");
    assert.match(spoken?.content ?? "", /Hetzner/);
  });

  await check("hash embeddings rank related text higher", async () => {
    const provider = new LocalHashEmbeddingProvider();
    const [query, related, other] = await provider.embedBatch([
      "Hetzner Pilot drei Monate",
      "Alliance Partner Hetzner startet mit Pilot von drei Monaten",
      "Die Bürokaffeemaschine tropft seit Montag",
    ]);
    assert.ok(cosineSimilarity(query, related) > cosineSimilarity(query, other));
    const stored = serializeEmbedding({ provider: provider.id, model: provider.model(), vector: related });
    assert.ok(parseEmbedding(stored));
    assert.ok(embeddingSimilarity(query, parseEmbedding(stored)) > 0.2);
    assert.ok(lexicalMemoryScore("Hetzner Pilot", "Hetzner", "Pilot drei Monate", "hetzner pilot") > 0.5);
  });

  return failures;
}
