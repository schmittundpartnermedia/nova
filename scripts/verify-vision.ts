import { PrismaClient } from "@prisma/client";
import { MockAIProvider } from "@/providers/ai/mock";
import { AnthropicProvider } from "@/providers/ai/anthropic";
import { LocalAIProvider } from "@/providers/ai/local";
import { OpenAIProvider } from "@/providers/ai/openai";
import { perceiveScreen } from "@/lib/computer/perception";
import { hasOpenAIApiKey } from "@/lib/secrets";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const mock = new MockAIProvider();
  const empty = await mock.analyzeImage!({
    imageBase64: "iVBORw0KGgo=",
    question: "Was siehst du?",
  });
  assert(empty.summary === "" || empty.provider === "mock", "Mock-Vision muss stubben");
  assert(Array.isArray(empty.windows) && Array.isArray(empty.elements), "Mock liefert Perception-Form");

  const anthropic = new AnthropicProvider();
  let anthropicThrew = false;
  try {
    await anthropic.analyzeImage!({ imageBase64: "x", question: "test" });
  } catch (error) {
    anthropicThrew = /später|nicht konfiguriert/i.test(error instanceof Error ? error.message : "");
  }
  assert(anthropicThrew, "Anthropic.analyzeImage muss klar als später markieren");

  const local = new LocalAIProvider();
  let localThrew = false;
  try {
    await local.analyzeImage!({ imageBase64: "x", question: "test" });
  } catch (error) {
    localThrew = /später|nicht konfiguriert/i.test(error instanceof Error ? error.message : "");
  }
  assert(localThrew, "Local.analyzeImage muss klar als später markieren");

  const prisma = new PrismaClient();
  const organization = await prisma.organization.findUnique({ where: { slug: "joachim" } });
  assert(organization, "Seed fehlt (Organization joachim).");

  const perceived = await perceiveScreen({
    organizationId: organization.id,
    question: "Kurze Beschreibung der Fenster (ohne sensible Inhalte).",
  });
  if (!perceived.ok) {
    console.log("perceiveScreen (erwartet ohne Screen-Permission/Helper ggf. fehlgeschlagen):", perceived.reason);
  } else {
    assert(perceived.perception.provider, "Perception braucht Provider");
    assert(typeof perceived.perception.summary === "string", "summary string");
    console.log("perceiveScreen ok:", perceived.perception.summary.slice(0, 120));
  }

  if (hasOpenAIApiKey()) {
    const openai = new OpenAIProvider();
    // Nur Interface/Health – kein dauerhaftes Bild speichern.
    const health = await openai.healthCheck();
    console.log("OpenAI health:", health.ok, health.message);
  } else {
    console.log("Kein OPENAI_API_KEY – OpenAI-Vision Live-Call übersprungen.");
  }

  await prisma.$disconnect();
  console.log("verify:vision ok");
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
