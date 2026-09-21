import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { listArchive } from "@/services/archive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const tenant = await getCurrentTenant();
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const type = url.searchParams.get("type") ?? "all";
    const { activities, conversationMessages } = await listArchive({
      organizationId: tenant.organizationId,
      query,
      type,
    });

    const conversationItems = conversationMessages.map((message) => ({
      id: `conversation-message:${message.id}`,
      timestamp: message.createdAt,
      type: "conversation",
      title:
        message.role === "user"
          ? `Joachim: ${message.content.slice(0, 120)}`
          : `NOVA: ${message.content.slice(0, 120)}`,
      description: message.content,
      status: "prepared",
      externalUrl: null,
      company: null,
      communication: null,
      task: null,
      project: null,
      contact: null,
    }));

    const activitiesJson = activities.map((item) => ({
      ...item,
      timestamp: item.timestamp instanceof Date ? item.timestamp.toISOString() : item.timestamp,
    }));

    const merged =
      type === "conversation"
        ? conversationItems.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))
        : query
          ? [...activitiesJson, ...conversationItems].sort(
              (a, b) => +new Date(String(b.timestamp)) - +new Date(String(a.timestamp)),
            )
          : activitiesJson;

    return NextResponse.json({ ok: true, activities: merged });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
