import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { hasOpenAIApiKey } from "@/lib/secrets";
import { MockMailProvider } from "@/connectors/mail/mock";
import { SmtpMailProvider, smtpConfigured } from "@/connectors/mail/smtp";
import { MockCalendarProvider } from "@/connectors/calendar/mock";
import { LocalCalendarProvider } from "@/connectors/calendar/local";
import { MockSearchProvider } from "@/connectors/search/mock";
import { OpenAISearchProvider } from "@/connectors/search/openai";
import { MockStorageProvider } from "@/connectors/storage/mock";
import { MockTaskProvider } from "@/connectors/tasks/mock";
import { MockContactsProvider } from "@/connectors/contacts/mock";
import { MockBrowserProvider } from "@/connectors/browser/mock";
import type { CalendarProvider, ConnectorType, MailProvider, SearchProvider } from "@/types/connectors";

const mailMock = new MockMailProvider();
const mailSmtp = new SmtpMailProvider();
const calendarMock = new MockCalendarProvider();
const calendarLocal = new LocalCalendarProvider();
const mockSearch = new MockSearchProvider();
const openaiSearch = new OpenAISearchProvider();
const storage = new MockStorageProvider();
const tasks = new MockTaskProvider();
const contacts = new MockContactsProvider();
const browser = new MockBrowserProvider();

export async function getMailProvider(organizationId: string): Promise<MailProvider> {
  assertOrganizationId(organizationId);
  if (smtpConfigured()) return mailSmtp;
  return mailMock;
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
  const [search, mail, calendar] = await Promise.all([
    getSearchProvider(organizationId),
    getMailProvider(organizationId),
    getCalendarProvider(organizationId),
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
    return smtpConfigured();
  }
  if (type === "calendar") {
    const provider = await getCalendarProvider(organizationId);
    return provider.id !== "mock-calendar";
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
