import type { CalendarProvider } from "@/types/connectors";

export class MockCalendarProvider implements CalendarProvider {
  id = "mock-calendar";

  async list(_organizationId: string, _from: Date, _to: Date): Promise<unknown[]> {
    return [];
  }

  async create(_organizationId: string, _event: Record<string, unknown>) {
    return {
      ok: false,
      executed: false,
      reason: "Kein echter Kalender-Connector verbunden. Termin wurde nicht angelegt.",
    };
  }

  async update(_organizationId: string, _eventId: string, _patch: Record<string, unknown>) {
    return {
      ok: false,
      executed: false,
      reason: "Kein echter Kalender-Connector verbunden. Termin wurde nicht geändert.",
    };
  }

  async cancel(_organizationId: string, _eventId: string) {
    return {
      ok: false,
      executed: false,
      reason: "Kein echter Kalender-Connector verbunden. Termin wurde nicht abgesagt.",
    };
  }

  async getEventUrl(_organizationId: string, _eventId: string): Promise<string | null> {
    return null;
  }
}
