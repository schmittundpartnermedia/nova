import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { authorizeExternalAction, decideApproval } from "@/services/approvals";
import { enqueueWorkItem } from "@/services/worker/queue";
import { meldeNutzer } from "@/services/meldungen";
import { parseKontaktliste, schreibeKontaktliste } from "@/lib/mail/kontaktlisten";
import { geschaetzteKostenUsd, type ScannerAuftrag, type ScannerRunner } from "@/lib/leads/scanner";

/**
 * Kundensuche über den Lead-Scanner: Freigabe → Hintergrund-Lauf (Worker „scanner.lauf“) → Einlesen in
 * Company/Contact und als Kontaktliste `kunden-<branche>-<ort>-<datum>` → Meldung an den Nutzer.
 * Nur Kunden (lokale Betriebe), keine Sponsoren. Gesendet wird hier nichts.
 */

export type KundensucheStart =
  | { status: "freigabe_noetig"; freigabe_id: string; kosten_usd: number; grund: string }
  | { status: "gestartet"; auftrag: ScannerAuftrag; kosten_usd: number };

function pruefeAuftrag(auftrag: ScannerAuftrag): ScannerAuftrag {
  const branche = auftrag.branche.trim();
  const ort = auftrag.ort.trim();
  const anzahl = Math.round(auftrag.anzahl);
  if (!branche || !ort) throw new Error("Branche und Ort sind nötig.");
  if (!Number.isFinite(anzahl) || anzahl < 1 || anzahl > 60) throw new Error("Anzahl muss zwischen 1 und 60 liegen.");
  return { branche, ort, anzahl };
}

export async function starteKundensuche(input: {
  organizationId: string;
  auftrag: ScannerAuftrag;
  freigabeId?: string;
}): Promise<KundensucheStart> {
  assertOrganizationId(input.organizationId);
  const auftrag = pruefeAuftrag(input.auftrag);
  const kosten = geschaetzteKostenUsd(auftrag.anzahl);
  if (input.freigabeId) {
    const pending = await prisma.approvalRequest.findFirst({
      where: { id: input.freigabeId, organizationId: input.organizationId, actionType: "scanner.start", status: "pending" },
    });
    const payload = pending ? (JSON.parse(pending.payload || "{}") as Partial<ScannerAuftrag>) : {};
    if (!pending || payload.branche !== auftrag.branche || payload.ort !== auftrag.ort || payload.anzahl !== auftrag.anzahl) {
      throw new Error("Diese Freigabe gehört nicht zu dieser Suche.");
    }
    await decideApproval({ organizationId: input.organizationId, approvalId: pending.id, status: "approved" });
  }
  const auth = await authorizeExternalAction({
    organizationId: input.organizationId,
    actionType: "scanner.start",
    description: `Lead-Scanner: ${auftrag.anzahl} × ${auftrag.branche} in ${auftrag.ort} (ca. ${kosten.toFixed(2)} $)`,
    payload: { ...auftrag },
    approvalToken: input.freigabeId,
    riskLevel: "external",
  });
  if (auth.decision === "need_approval") {
    return { status: "freigabe_noetig", freigabe_id: auth.approvalId, kosten_usd: kosten, grund: auth.reason };
  }
  if (auth.decision === "deny_hard") throw new Error(auth.reason);
  await enqueueWorkItem({
    organizationId: input.organizationId,
    kind: "scanner.lauf",
    idempotencyKey: `scanner.lauf:${auftrag.branche}:${auftrag.ort}:${auftrag.anzahl}:${Date.now()}`,
    payload: { ...auftrag },
    maxAttempts: 1,
  });
  return { status: "gestartet", auftrag, kosten_usd: kosten };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Worker-Teil: Scanner laufen lassen, Ergebnis einlesen, melden. */
export async function fuehreKundensucheAus(input: {
  organizationId: string;
  auftrag: ScannerAuftrag;
  runner: ScannerRunner;
  heute?: Date;
}) {
  const auftrag = pruefeAuftrag(input.auftrag);
  let lauf;
  try {
    lauf = await input.runner(auftrag);
  } catch (error) {
    const grund = error instanceof Error ? error.message : String(error);
    await meldeNutzer({
      organizationId: input.organizationId,
      anlass: `kundensuche-fehler:${Date.now()}`,
      text: `Die Kundensuche „${auftrag.branche} in ${auftrag.ort}“ ist fehlgeschlagen: ${grund}`,
    });
    return { ok: false as const, grund };
  }

  const zeilen = parseKontaktliste(fs.readFileSync(lauf.csvPfad, "utf8")).map((zeile) => zeile.werte);
  const kunden: Array<Record<string, string>> = [];
  for (const werte of zeilen) {
    const firma = (werte.name ?? "").trim();
    if (!firma) continue;
    const ansprechpartner = (werte.ansprechpartner || werte.inhabername || "").trim();
    const email = (werte.email ?? "").trim();
    const website = (werte.finalurl || werte.website || "").trim();
    kunden.push({
      firma,
      ansprechpartner,
      anrede: ansprechpartner ? `Guten Tag ${ansprechpartner}` : `Sehr geehrtes ${firma}-Team`,
      email,
      telefon: (werte.telefon ?? "").trim(),
      ort: auftrag.ort,
      branche: auftrag.branche,
      website,
      score: (werte.score ?? "").trim(),
      befunde: (werte.befunde ?? "").trim(),
      aufhaenger: (werte.aufhaenger ?? "").trim(),
    });

    const quelle = domain(website) ? `web:${domain(website)}` : `name:${firma.toLowerCase()}|${auftrag.ort.toLowerCase()}`;
    const company =
      (await prisma.company.findFirst({ where: { organizationId: input.organizationId, sourceId: quelle } })) ??
      (await prisma.company.create({
        data: {
          organizationId: input.organizationId,
          name: firma,
          industry: auftrag.branche,
          website: website || null,
          sourceId: quelle,
          notes: [werte.adresse, werte.telefon, werte.befunde].filter(Boolean).join(" | ") || null,
        },
      }));
    if (email || ansprechpartner) {
      const bekannt = await prisma.contact.findFirst({
        where: { organizationId: input.organizationId, companyId: company.id, ...(email ? { email } : { sourceId: quelle }) },
      });
      if (!bekannt) {
        const teile = ansprechpartner.split(/\s+/).filter(Boolean);
        await prisma.contact.create({
          data: {
            organizationId: input.organizationId,
            companyId: company.id,
            firstName: teile.length > 1 ? teile.slice(0, -1).join(" ") : "",
            lastName: teile.at(-1) ?? "",
            role: ansprechpartner ? "Ansprechpartner (Impressum)" : null,
            email: email || null,
            phone: (werte.telefon ?? "").trim() || null,
            sourceId: quelle,
          },
        });
      }
    }
  }

  const datum = (input.heute ?? new Date()).toISOString().slice(0, 10);
  const liste = schreibeKontaktliste(
    `kunden-${slug(auftrag.branche)}-${slug(auftrag.ort)}-${datum}`,
    ["firma", "ansprechpartner", "anrede", "email", "telefon", "ort", "branche", "website", "score", "befunde", "aufhaenger"],
    kunden,
  );
  const mitEmail = kunden.filter((kunde) => kunde.email).length;
  const mitPerson = kunden.filter((kunde) => kunde.ansprechpartner).length;
  const top = [...kunden]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 3)
    .map((kunde) => kunde.firma);
  await meldeNutzer({
    organizationId: input.organizationId,
    anlass: `kundensuche-fertig:${liste}`,
    text:
      `Kundensuche „${auftrag.branche} in ${auftrag.ort}“ ist fertig: ${kunden.length} Betriebe, ${mitEmail} mit E-Mail, ${mitPerson} mit Ansprechpartner. ` +
      `Liste „${liste}“ liegt in ~/Nova/kampagnen/.` +
      (top.length ? ` Größter Handlungsbedarf: ${top.join(", ")}.` : ""),
  });
  return { ok: true as const, liste, anzahl: kunden.length, mitEmail, mitPerson };
}
