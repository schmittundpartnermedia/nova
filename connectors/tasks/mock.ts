import type { TaskProvider } from "@/types/connectors";

export class MockTaskProvider implements TaskProvider {
  id = "mock-tasks";

  async list(_organizationId: string): Promise<unknown[]> {
    return [];
  }
}
