import type { BrowserProvider } from "@/types/connectors";

export class MockBrowserProvider implements BrowserProvider {
  id = "mock-browser";

  async open(_organizationId: string, _url: string) {
    return {
      ok: false,
      executed: false,
      reason: "Browser-Agent ist in V1 nur als Interface vorbereitet.",
    };
  }
}
