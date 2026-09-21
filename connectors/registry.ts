import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { hasOpenAIApiKey } from "@/lib/secrets";
import { MockMailProvider } from "@/connectors/mail/mock";
import { MockCalendarProvider } from "@/connectors/calendar/mock";
import { MockSearchProvider } from "@/connectors/search/mock";
import { OpenAISearchProvider } from "@/connectors/search/openai";
import { MockStorageProvider } from "@/connectors/storage/mock";
import { MockTaskProvider } from "@/connectors/tasks/mock";
import { MockContactsProvider } from "@/connectors/contacts/mock";
import { MockBrowserProvider } from "@/connectors/browser/mock";
import type { ConnectorType, SearchProvider } from "@/types/connectors";

const mail = new MockMailProvider();
const calendar = new MockCalendarProvider();
const mockSearch = new MockSearchProvider();
const openaiSearch = new OpenAISearchProvider();
const storage = new MockStorageProvider();
const tasks = new MockTaskProvider();
const contacts = new MockContactsProvider();
const browser = new MockBrowserProvider();

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
  const search = await getSearchProvider(organizationId);

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
