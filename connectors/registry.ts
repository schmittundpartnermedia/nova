import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { hasOpenAIApiKey } from "@/lib/secrets";
import { AppleMailProvider } from "@/connectors/mail/apple";
import { BlockedMailProvider } from "@/connectors/mail/blocked";
import { ImapSmtpMailProvider } from "@/connectors/mail/imap";
import { passwordSmtpEnabled } from "@/connectors/mail/smtp";
import { readMailAutomationState } from "@/services/mail/apple-events";
import { MockCalendarProvider } from "@/connectors/calendar/mock";
import { LocalCalendarProvider } from "@/connectors/calendar/local";
import { MockSearchProvider } from "@/connectors/search/mock";
import { OpenAISearchProvider } from "@/connectors/search/openai";
import { MockStorageProvider } from "@/connectors/storage/mock";
import { LocalDiskStorageProvider } from "@/connectors/storage/local";
import { MockTaskProvider } from "@/connectors/tasks/mock";
import { MockContactsProvider } from "@/connectors/contacts/mock";
import { MockBrowserProvider } from "@/connectors/browser/mock";
import type { CalendarProvider, ConnectorType, MailProvider, SearchProvider, StorageProvider } from "@/types/connectors";

const mailBlocked = new BlockedMailProvider();
const mailImap = new ImapSmtpMailProvider();
const mailApple = new AppleMailProvider();
const calendarMock = new MockCalendarProvider();
const calendarLocal = new LocalCalendarProvider();
const mockSearch = new MockSearchProvider();
const openaiSearch = new OpenAISearchProvider();
const storageMock = new MockStorageProvider();
const storageLocal = new LocalDiskStorageProvider();
const tasks = new MockTaskProvider();
const contacts = new MockContactsProvider();
const browser = new MockBrowserProvider();

export async function getMailProvider(organizationId: string): Promise<MailProvider> {
  assertOrganizationId(organizationId);
  const apple = await prisma.mailAccount.findFirst({
    where: { organizationId, status: "connected", provider: "apple-mail" },
  });
  if (apple) {
    const automation = await readMailAutomationState();
    if (automation === "granted") return mailApple;
    return mailBlocked;
  }
  const account = await prisma.mailAccount.findFirst({
    where: {
      organizationId,
      status: "connected",
      provider: { in: ["google", "microsoft"] },
      NOT: { credentialRef: null },
    },
  });
  if (account && !passwordSmtpEnabled()) return mailImap;
  return mailBlocked;
}

export async function getCalendarProvider(organizationId: string): Promise<CalendarProvider> {
  assertOrganizationId(organizationId);
  const config = await prisma.connectorConfig.findFirst({
    where: { organizationId, type: "calendar", enabled: true },
    orderBy: { updatedAt: "desc" },
  });
  if (config?.provider === "mock") return calendarMock;
  return calendarLocal;
}

export async function getStorageProvider(organizationId: string): Promise<StorageProvider> {
  assertOrganizationId(organizationId);
  const config = await prisma.connectorConfig.findFirst({
    where: { organizationId, type: "storage", enabled: true },
    orderBy: { updatedAt: "desc" },
  });
  if (config?.provider === "mock") return storageMock;
  return storageLocal;
}

export async function getSearchProvider(organizationId: string): Promise<SearchProvider> {
  assertOrganizationId(organizationId);
  const config = await prisma.connectorConfig.findFirst({
    where: {
      organizationId,
      type: "search",
      enabled: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const requested = config?.provider && config.provider !== "mock" ? config.provider : hasOpenAIApiKey() ? "openai" : "mock";
  if ((requested === "openai" || requested === "openai-web-search") && hasOpenAIApiKey()) {
    return openaiSearch;
  }
  return mockSearch;
}

export async function getOrganizationConnectors(organizationId: string) {
  assertOrganizationId(organizationId);
  const configs = await prisma.connectorConfig.findMany({
    where: { organizationId },
  });
  const [search, mail, calendar, storage] = await Promise.all([
    getSearchProvider(organizationId),
    getMailProvider(organizationId),
    getCalendarProvider(organizationId),
    getStorageProvider(organizationId),
  ]);

  return {
    organizationId,
    configs,
    mail,
    calendar,
    search,
    storage,
    tasks,
    contacts,
    browser,
    note: "Connector-Instanzen sind organizationsbezogen vorbereitet. Credentials werden niemals global geteilt.",
  };
}

export type ConnectorCapabilityState = "AVAILABLE" | "LOCAL_ONLY" | "BLOCKED" | "MOCK" | "UNAVAILABLE";

export async function getConnectorCapabilityMap(organizationId: string): Promise<Record<ConnectorType, ConnectorCapabilityState>> {
  assertOrganizationId(organizationId);
  const [search, mail, calendar, storage] = await Promise.all([
    getSearchProvider(organizationId),
    getMailProvider(organizationId),
    getCalendarProvider(organizationId),
    getStorageProvider(organizationId),
  ]);
  return {
    search: search.mock ? "MOCK" : "AVAILABLE",
    mail: mail.id === "apple-mail" || mail.id === "imap-smtp" ? "AVAILABLE" : "BLOCKED",
    calendar: calendar.id === "mock-calendar" ? "MOCK" : "LOCAL_ONLY",
    storage: storage.id === "mock-storage" ? "MOCK" : "LOCAL_ONLY",
    tasks: "MOCK",
    contacts: "MOCK",
    browser: "MOCK",
  };
}

export function isMockCapability(state: ConnectorCapabilityState): boolean {
  return state === "MOCK";
}

export async function isRealConnectorEnabled(
  organizationId: string,
  type: ConnectorType,
): Promise<boolean> {
  assertOrganizationId(organizationId);
  if (type === "search") {
    const provider = await getSearchProvider(organizationId);
    return provider.mock === false;
  }
  if (type === "mail") {
    const apple = await prisma.mailAccount.findFirst({
      where: { organizationId, status: "connected", provider: "apple-mail" },
    });
    if (apple) return (await readMailAutomationState()) === "granted";
    const account = await prisma.mailAccount.findFirst({
      where: { organizationId, status: "connected", provider: { in: ["google", "microsoft"] }, NOT: { credentialRef: null } },
    });
    return Boolean(account) && !passwordSmtpEnabled();
  }
  if (type === "calendar") {
    const provider = await getCalendarProvider(organizationId);
    return provider.id !== "mock-calendar";
  }
  if (type === "storage") {
    const provider = await getStorageProvider(organizationId);
    return provider.id !== "mock-storage";
  }
  const config = await prisma.connectorConfig.findFirst({
    where: {
      organizationId,
      type,
      enabled: true,
      NOT: { provider: "mock" },
    },
  });
  return Boolean(config);
}
