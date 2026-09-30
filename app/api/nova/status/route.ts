import { NextResponse } from "next/server";
import { getCurrentTenant } from "@/services/tenant";
import { getOrCreateActiveConversation } from "@/services/conversation";
import { holeNeueMeldungen } from "@/services/meldungen";
import { prisma } from "@/lib/prisma";
import { alleAuftraege } from "@/services/claude";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Status für die Oberfläche: neue Meldungen (einmalig), laufende Kampagnen und laufende Claude-Aufträge. */
export async function GET() {
  try {
    const tenant = await getCurrentTenant();
    const conversation = await getOrCreateActiveConversation(tenant.organizationId);
    const meldungen = await holeNeueMeldungen(tenant.organizationId);
    const laufend = await prisma.campaign.findMany({
      where: { organizationId: tenant.organizationId, status: "laeuft" },
      orderBy: { startedAt: "asc" },
    });
    const kampagnen = await Promise.all(
      laufend.map(async (kampagne) => {
        const [gesamt, gesendet] = await Promise.all([
          prisma.communication.count({ where: { campaignId: kampagne.id, direction: "outbound" } }),
          prisma.communication.count({ where: { campaignId: kampagne.id, direction: "outbound", status: "sent" } }),
        ]);
        return { id: kampagne.id, name: kampagne.name, gesamt, gesendet };
      }),
    );
    const arbeit = alleAuftraege()
      .filter((auftrag) => auftrag.organizationId === tenant.organizationId)
      .filter((auftrag) => auftrag.status === "geplant" || auftrag.status === "laeuft" || auftrag.status === "wird_live")
      .map((auftrag) => (auftrag.status === "wird_live" ? `stelle live: ${auftrag.projekt}` : `arbeite: Claude an ${auftrag.projekt}`));
    return NextResponse.json({
      ok: true,
      tenant: {
        organizationName: tenant.organizationName,
        userName: tenant.userName,
      },
      conversation: {
        id: conversation.id,
        title: conversation.title,
        lastActivityAt: conversation.lastActivityAt,
        status: conversation.status,
      },
      meldungen,
      kampagnen,
      arbeit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
