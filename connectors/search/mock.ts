import type { SearchProvider, SearchQuery, SearchResponse } from "@/types/connectors";

export class MockSearchProvider implements SearchProvider {
  id = "mock-search";
  mock = true;

  async search(input: SearchQuery): Promise<SearchResponse> {
    return {
      mock: true,
      results: [],
      queries: [input.query],
      error: "mock_search",
    };
  }
}
