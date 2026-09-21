import type { ContactsProvider } from "@/types/connectors";

export class MockContactsProvider implements ContactsProvider {
  id = "mock-contacts";

  async search(_organizationId: string, _query: string): Promise<unknown[]> {
    return [];
  }
}
