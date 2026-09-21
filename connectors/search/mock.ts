import type { SearchProvider } from "@/types/connectors";

export class MockSearchProvider implements SearchProvider {
  id = "mock-search";

  async search(_organizationId: string, query: string) {
    return {
      mock: true,
      results: [
        {
          title: "Mock-Suchergebnis",
          snippet: `Keine echte Websuche. Query war: ${query}`,
          url: null,
        },
      ],
    };
  }
}
