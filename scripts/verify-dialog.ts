import { PrismaClient } from "@prisma/client";
import { runMaster } from "@/agents/master";
import { runDialogUnitTests } from "@/lib/dialog/unit-tests";
import { detectDialogMove } from "@/lib/dialog/intent";
import { bootstrapAgents } from "@/agents/bootstrap";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function looksLikeLexicon(reply: string): boolean {
  return /bedeutet|definition|arbeitsende|schluss der arbeit|feierabend ist|bezeichnet/i.test(reply);
}

async function main() {
  bootstrapAgents();
  const unit = runDialogUnitTests();
  if (unit.length) {
    throw new Error(`Dialog-Unit-Tests fehlgeschlagen: ${unit.join("; ")}`);
  }

  const organization = await prisma.organization.findUnique({ where: { slug: "joachim" } });
  if (!organization) throw new Error("Seed fehlt.");

  const wish = await runMaster({
    organizationId: organization.id,
    userRequest: "Schönen Feierabend",
  });
  assert(detectDialogMove("Schönen Feierabend").kind === "social", "Feierabend nicht als sozial erkannt");
  assert(!looksLikeLexicon(wish.reply), `Feierabend wurde erklärt: ${wish.reply}`);
  assert(
    /(danke|dir auch|ebenfalls|ebenso|gleichfalls)/i.test(wish.reply),
    `Feierabend ohne Erwiderung: ${wish.reply}`,
  );
  assert(wish.providerId !== "knowledge", `Sozialer Zug lief über Knowledge-Dosenpfad: ${wish.providerId}`);

  const thanks = await runMaster({
    organizationId: organization.id,
    userRequest: "Danke",
  });
  assert(!looksLikeLexicon(thanks.reply), `Dank wurde erklärt: ${thanks.reply}`);
  assert(thanks.reply.length < 280, `Dank zu lang: ${thanks.reply}`);
  assert(!/^nova\s*:/i.test(thanks.reply.trim()), `Dank mit Namenspräfix: ${thanks.reply}`);
  assert(!/wie kann ich (dir )?helfen/i.test(thanks.reply), `Dank kippt in Servicefrage: ${thanks.reply}`);

  const greeting = await runMaster({
    organizationId: organization.id,
    userRequest: "Hallo",
  });
  assert(!/ich bin (ein |dein )?ki-business-assistent/i.test(greeting.reply), `Begrüßung wie ein Assistent: ${greeting.reply}`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        wish: wish.reply,
        thanks: thanks.reply,
        greeting: greeting.reply,
        provider: wish.providerId,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
