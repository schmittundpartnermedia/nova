import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { MockMailProvider } from "@/connectors/mail/mock";
import { MockCalendarProvider } from "@/connectors/calendar/mock";
import { MockSearchProvider } from "@/connectors/search/mock";
import { MockStorageProvider } from "@/connectors/storage/mock";
import { MockTaskProvider } from "@/connectors/tasks/mock";
import { MockContactsProvider } from "@/connectors/contacts/mock";
import { MockBrowserProvider } from "@/connectors/browser/mock";
import type { ConnectorType } from "@/types/connectors";

const mail = new MockMailProvider();
const calendar = new MockCalendarProvider();
const search = new MockSearchProvider();
const storage = new MockStorageProvider();
const tasks = new MockTaskProvider();
const contacts = new MockContactsProvider();
const browser = new MockBrowserProvider();

export async function getOrganizationConnectors(organizationId: string) {
  assertOrganizationId(organizationId);
  const configs = await prisma.connectorConfig.findMany({
    where: { organizationId },
  });

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
