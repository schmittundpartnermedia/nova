import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { getMailCapabilityMap, type MailCapabilityName } from "@/services/mail/capabilities";
import { promptMailAutomationAccess } from "@/services/mail/apple-connect";

type MailAccessCapability = Extract<MailCapabilityName, "MAIL_READ" | "MAIL_SEARCH">;

function blockedReply(input: {
  reason?: string;
  appleAccounts: number;
  action: "lesen" | "suchen";
}): { reply: string; statusMessage: string } {
  if (input.reason === "AUTOMATION_PERMISSION_REQUIRED" && input.appleAccounts > 0) {
    return {
      reply: "macOS benötigt einmalig deine Freigabe für Apple Mail.",
      statusMessage: "macOS-Freigabe für Mail ausstehend.",
    };
  }
  if (input.reason === "AUTOMATION_DENIED" && input.appleAccounts > 0) {
    return {
      reply:
        "Deine Apple-Mail-Accounts sind verbunden, aber macOS blockiert die Steuerung von Mail. Erlaube NOVA unter Datenschutz und Sicherheit → Automation.",
      statusMessage: "Mail-Automatisierung verweigert.",
    };
  }
  if (input.reason === "PROVIDER_UNAVAILABLE") {
    return {
      reply: "Apple Mail ist gerade nicht erreichbar. Ich kann dein Postfach deshalb nicht öffnen.",
      statusMessage: "Mail nicht verfügbar.",
    };
  }
  if (input.appleAccounts === 0 || input.reason === "ACCOUNT_NOT_CONNECTED") {
    return {
      reply: "Es ist kein Mailkonto verbunden. Verbinde zuerst Apple Mail in NOVA.",
      statusMessage: "Kein Mailkonto.",
    };
  }
  return {
    reply: `Ich kann dein Postfach gerade nicht ${input.action}.`,
    statusMessage: "Mail blockiert.",
  };
}

export async function prepareMailAccess(input: {
  organizationId: string;
  capability: MailAccessCapability;
  action: "lesen" | "suchen";
  onConsentPrompt?: () => void;
}): Promise<{ ready: true } | { ready: false; reply: string; statusMessage: string }> {
  assertOrganizationId(input.organizationId);
  const appleAccounts = await prisma.mailAccount.count({
    where: { organizationId: input.organizationId, provider: "apple-mail", status: "connected" },
  });

  let capabilities = await getMailCapabilityMap(input.organizationId);
  let gate = capabilities[input.capability];
  if (gate.state !== "BLOCKED") return { ready: true };

  if (gate.state === "BLOCKED" && appleAccounts > 0 && gate.reason !== "AUTOMATION_DENIED") {
    input.onConsentPrompt?.();
    await promptMailAutomationAccess();
    capabilities = await getMailCapabilityMap(input.organizationId);
    gate = capabilities[input.capability];
    if (gate.state !== "BLOCKED") return { ready: true };
  }

  if (gate.state === "BLOCKED") {
    const message = blockedReply({ reason: gate.reason, appleAccounts, action: input.action });
    return { ready: false, ...message };
  }
  return { ready: true };
}
