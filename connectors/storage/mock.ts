import type { StorageProvider } from "@/types/connectors";

export class MockStorageProvider implements StorageProvider {
  id = "mock-storage";

  async search(_organizationId: string, _query: string): Promise<unknown[]> {
    return [];
  }

  async read(_organizationId: string, _path: string): Promise<string | null> {
    return null;
  }

  async create(_organizationId: string, _input: { title: string; content: string }) {
    return {
      ok: false,
      executed: false,
      reason: "Kein echter Storage-Connector verbunden. Datei wurde nicht geschrieben.",
    };
  }

  async getUrl(_organizationId: string, _path: string): Promise<string | null> {
    return null;
  }
}
