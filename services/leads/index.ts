import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { authorizeExternalAction, decideApproval } from "@/services/approvals";
import { enqueueWorkItem } from "@/services/worker/queue";
import { meldeNutzer } from "@/services/meldungen";
import { parseKontaktliste, schreibeKontaktliste } from "@/lib/mail/kontaktlisten";
import { schaetzeKosten, type GebietsAuftrag, type GebietsRunner } from "@/lib/leads/scanner";
import { markiereErledigt } from "@/services/tagesbetrieb/suchplan";
import { pruefeAdresse, type MxPruefer } from "@/services/tagesbetrieb/pruefen";

/**
 * Kundensuche als Gebietssuche: ALLE Betriebe einer Branche im Umkreis um einen Ort (Lead-Scanner, src/gebiet.ts).
 * Freigabe (mit Kostenschätzung) → Hintergrund-Lauf (Worker „scanner.lauf“) → jeder Betrieb kommt in den Vorrat
 * (Tabelle leads, Adresse geprüft) und als Firma/Kontakt; dazu eine Liste `kunden-<branche>-<ort>-<km>km-<datum>`
 * zur Dokumentation → Meldung mit ehrlichen Zahlen. Angeschrieben wird hier niemand: Das macht der Tagesbetrieb
 * (15 am Tag) oder eine Kampagne. Nur Kunden (lokale Betriebe), keine Sponsoren.
 */

export type KundensucheStart =
  | { status: "freigabe_noetig"; freigabe_id: string; kosten_usd: number; max_kosten_usd: number; grund: string }
  | { status: "gestartet"; auftrag: GebietsAuftrag; kosten_usd: number; max_kosten_usd: number };

export function pruefeAuftrag(auftrag: GebietsAuftrag): GebietsAuftrag {
  const branche = auftrag.branche.trim();
  const mitte = auftrag.mitte.trim();
  const radiusKm = Math.round(auftrag.radiusKm);
  if (!branche || !mitte) throw new Error("Branche und Ort (Mittelpunkt) sind nötig.");
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 60) throw new Error("Der Umkreis muss zwischen 1 und 60 km liegen.");
  return { branche, mitte, radiusKm };
}

function beschreibung(auftrag: GebietsAuftrag): string {
  return `${auftrag.branche} im Umkreis von ${auftrag.radiusKm} km um ${auftrag.mitte}`;
}

export async function starteKundensuche(input: {
  organizationId: string;
  auftrag: GebietsAuftrag;
  freigabeId?: string;
}): Promise<KundensucheStart> {
  assertOrganizationId(input.organizationId);
  const auftrag = pruefeAuftrag(input.auftrag);
  const kosten = schaetzeKosten(auftrag.radiusKm);
  if (input.freigabeId) {
    const pending = await prisma.approvalRequest.findFirst({
      where: { id: input.freigabeId, organizationId: input.organizationId, actionType: "scanner.start", status: "pending" },
    });
    const payload = pending ? (JSON.parse(pending.payload || "{}") as Partial<GebietsAuftrag>) : {};
    if (!pending || payload.branche !== auftrag.branche || payload.mitte !== auftrag.mitte || payload.radiusKm !== auftrag.radiusKm) {
      throw new Error("Diese Freigabe gehört nicht zu dieser Suche.");
    }
    await decideApproval({ organizationId: input.organizationId, approvalId: pending.id, status: "approved" });
  }
  const auth = await authorizeExternalAction({
    organizationId: input.organizationId,
    actionType: "scanner.start",
    description: `Lead-Scanner: alle ${beschreibung(auftrag)} (ca. ${kosten.kostenUsd.toFixed(2)} $, höchstens ${kosten.maxKostenUsd.toFixed(2)} $)`,
    payload: { ...auftrag },
    approvalToken: input.freigabeId,
    riskLevel: "external",
  });
  if (auth.decision === "need_approval") {
    return { status: "freigabe_noetig", freigabe_id: auth.approvalId, kosten_usd: kosten.kostenUsd, max_kosten_usd: kosten.maxKostenUsd, grund: auth.reason };
  }
  if (auth.decision === "deny_hard") throw new Error(auth.reason);
  await enqueueWorkItem({
    organizationId: input.organizationId,
    kind: "scanner.lauf",
    idempotencyKey: `scanner.lauf:${auftrag.branche}:${auftrag.mitte}:${auftrag.radiusKm}:${Date.now()}`,
    payload: { ...auftrag },
    maxAttempts: 1,
  });
  return { status: "gestartet", auftrag, kosten_usd: kosten.kostenUsd, max_kosten_usd: kosten.maxKostenUsd };
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

function anrede(firma: string, ansprechpartner: string | null): string {
  return ansprechpartner ? `Guten Tag ${ansprechpartner}` : `Sehr geehrtes ${firma}-Team`;
}

/**
 * Liest eine CSV des Lead-Scanners in den Vorrat (Tabelle leads) ein. Bekannte Betriebe (gleiche Adresse;
 * ohne Adresse gleiche Firma und gleicher Ort) werden übersprungen – außer zurückgestellte, die kommen wieder dran.
 */
export async function leseLeadsEin(
  organizationId: string,
  csvPfad: string,
  kontext: { branche?: string } = {},
): Promise<{ neu: number; ohneEmail: number }> {
  assertOrganizationId(organizationId);
  const zeilen = parseKontaktliste(fs.readFileSync(csvPfad, "utf8")).map((zeile) => zeile.werte);
  let neu = 0;
  let ohneEmail = 0;
  for (const werte of zeilen) {
    const firma = (werte.name ?? "").trim();
    if (!firma) continue;
    const email = (werte.email ?? "").trim().toLowerCase() || null;
    const ort = (werte.ort ?? "").trim() || null;
    const bekannt = email
      ? await prisma.lead.findFirst({ where: { organizationId, email } })
      : await prisma.lead.findFirst({ where: { organizationId, email: null, firma, ort } });
    if (bekannt?.status === "zurueckgestellt") {
      // Zurückgestellt, bis seine Branche dran ist – jetzt ist sie dran.
      await prisma.lead.update({ where: { id: bekannt.id }, data: { status: "neu", grund: null, geprueftAt: null, quelle: csvPfad } });
      neu += 1;
      continue;
    }
    if (bekannt) continue;
    const ansprechpartner = (werte.ansprechpartner || werte.inhabername || "").trim() || null;
    const score = Number.parseInt(werte.score ?? "", 10);
    await prisma.lead.create({
      data: {
        organizationId,
        firma,
        ansprechpartner,
        anrede: anrede(firma, ansprechpartner),
        email,
        telefon: (werte.telefon ?? "").trim() || null,
        ort,
        branche: (kontext.branche ?? werte.branche ?? "").trim() || null,
        website: (werte.finalurl || werte.website || "").trim() || null,
        befunde: (werte.befunde ?? "").trim() || null,
        aufhaenger: (werte.aufhaenger ?? "").trim() || null,
        score: Number.isFinite(score) ? score : null,
        quelle: csvPfad,
        status: email ? "neu" : "verworfen",
        grund: email ? null : "keine E-Mail-Adresse",
        geprueftAt: email ? null : new Date(),
      },
    });
    neu += 1;
    if (!email) ohneEmail += 1;
  }
  return { neu, ohneEmail };
}

/** Prüft alle neuen Leads (Form, MX, Sperrliste, schon angeschrieben). */
export async function pruefeNeueLeads(organizationId: string, mx: MxPruefer): Promise<{ geprueft: number; verworfen: number; gruende: Record<string, number> }> {
  const neue = await prisma.lead.findMany({ where: { organizationId, status: "neu" }, orderBy: { createdAt: "asc" } });
  let geprueft = 0;
  let verworfen = 0;
  const gruende: Record<string, number> = {};
  for (const lead of neue) {
    const ergebnis = await pruefeAdresse({ organizationId, email: lead.email, mx });
    await prisma.lead.update({
      where: { id: lead.id },
      data: ergebnis.ok
        ? { status: "geprueft", grund: null, geprueftAt: new Date() }
        : { status: "verworfen", grund: ergebnis.grund, geprueftAt: new Date() },
    });
    if (ergebnis.ok) geprueft += 1;
    else {
      verworfen += 1;
      const grund = ergebnis.grund.replace(/\(.*\)/, "").replace(/Domain \S+ /, "Domain ").trim();
      gruende[grund] = (gruende[grund] ?? 0) + 1;
    }
  }
  return { geprueft, verworfen, gruende };
}

export type GebietssucheErgebnis =
  | {
      ok: true;
      liste: string;
      gefunden: number;
      mitEmail: number;
      neuImVorrat: number;
      verworfen: number;
      gruende: Record<string, number>;
      anfragen: number | null;
      vollstaendig: boolean;
    }
  | { ok: false; grund: string };

/** Worker-Teil: Gebietssuche laufen lassen, alles einlesen (Vorrat, Firmen, Liste), ehrlich melden. */
export async function fuehreGebietssucheAus(input: {
  organizationId: string;
  auftrag: GebietsAuftrag;
  runner: GebietsRunner;
  mx: MxPruefer;
  heute?: Date;
  /** Meldung an Joachim (Standard: ja). */
  melden?: boolean;
}): Promise<GebietssucheErgebnis> {
  const auftrag = pruefeAuftrag(input.auftrag);
  const was = beschreibung(auftrag);
  let lauf;
  try {
    lauf = await input.runner({ ...auftrag, maxAnfragen: schaetzeKosten(auftrag.radiusKm).maxAnfragen });
  } catch (error) {
    const grund = error instanceof Error ? error.message : String(error);
    await meldeNutzer({
      organizationId: input.organizationId,
      anlass: `kundensuche-fehler:${Date.now()}`,
      text: `Die Suche nach allen ${was} ist fehlgeschlagen: ${grund}`,
    });
    return { ok: false, grund };
  }

  const zeilen = parseKontaktliste(fs.readFileSync(lauf.csvPfad, "utf8")).map((zeile) => zeile.werte);
  const kunden: Array<Record<string, string>> = [];
  for (const werte of zeilen) {
    const firma = (werte.name ?? "").trim();
    if (!firma) continue;
    const ansprechpartner = (werte.ansprechpartner || werte.inhabername || "").trim();
    const email = (werte.email ?? "").trim();
    const website = (werte.finalurl || werte.website || "").trim();
    const ort = (werte.ort ?? "").trim() || auftrag.mitte;
    kunden.push({
      firma,
      ansprechpartner,
      anrede: anrede(firma, ansprechpartner || null),
      email,
      telefon: (werte.telefon ?? "").trim(),
      ort,
      entfernung_km: (werte.entfernungkm ?? "").trim(),
      branche: auftrag.branche,
      website,
      score: (werte.score ?? "").trim(),
      befunde: (werte.befunde ?? "").trim(),
      aufhaenger: (werte.aufhaenger ?? "").trim(),
    });

    const quelle = domain(website) ? `web:${domain(website)}` : `name:${firma.toLowerCase()}|${ort.toLowerCase()}`;
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
    `kunden-${slug(auftrag.branche)}-${slug(auftrag.mitte)}-${auftrag.radiusKm}km-${datum}`,
    ["firma", "ansprechpartner", "anrede", "email", "telefon", "ort", "entfernung_km", "branche", "website", "score", "befunde", "aufhaenger"],
    kunden,
  );
  const eingelesen = await leseLeadsEin(input.organizationId, lauf.csvPfad, { branche: auftrag.branche });
  const pruefung = await pruefeNeueLeads(input.organizationId, input.mx);
  const mitEmail = kunden.filter((kunde) => kunde.email).length;
  // Ergebniszeile des Scanners: „Gebiet: 212 Betriebe, 140 mit E-Mail, 131 Anfragen“ (nicht die Startzeile „höchstens … Anfragen“).
  const anfragen = Number(lauf.ausgabe.match(/^Gebiet: .*?(\d+) Anfragen/m)?.[1] ?? Number.NaN);
  const vollstaendig = !/unvollständig|KOSTENGRENZE/i.test(lauf.ausgabe);
  const gruendeText = Object.entries(pruefung.gruende)
    .sort((a, b) => b[1] - a[1])
    .map(([grund, anzahl]) => `${anzahl} ${grund}`)
    .join(", ");

  // Suchplan: Diese Branche ist in diesem Gebiet durchsucht – egal ob auf Zuruf oder vom Tagesbetrieb gestartet.
  markiereErledigt({
    branche: auftrag.branche,
    mitte: auftrag.mitte,
    radiusKm: auftrag.radiusKm,
    datum: (input.heute ?? new Date()).toISOString().slice(0, 10),
    betriebe: kunden.length,
    vollstaendig,
  });

  if (input.melden !== false) {
    await meldeNutzer({
      organizationId: input.organizationId,
      anlass: `kundensuche-fertig:${liste}`,
      text:
        `Die Suche nach allen ${was} ist fertig: ${kunden.length} Betriebe gefunden, ${mitEmail} davon mit E-Mail. ` +
        `${pruefung.geprueft} sind neu und geprüft im Vorrat und werden nach und nach angeschrieben` +
        (pruefung.verworfen ? `, ${pruefung.verworfen} nicht (${gruendeText})` : "") +
        `. Liste „${liste}“ liegt in ~/Nova/kampagnen/.` +
        (Number.isFinite(anfragen) ? ` ${anfragen} Google-Anfragen, etwa ${(anfragen * 0.035).toFixed(2).replace(".", ",")} $.` : "") +
        (vollstaendig ? "" : " Achtung: Die Kostengrenze war erreicht, das Gebiet ist nicht vollständig durchsucht."),
    });
  }
  return {
    ok: true,
    liste,
    gefunden: kunden.length,
    mitEmail,
    neuImVorrat: pruefung.geprueft,
    verworfen: pruefung.verworfen + eingelesen.ohneEmail,
    gruende: pruefung.gruende,
    anfragen: Number.isFinite(anfragen) ? anfragen : null,
    vollstaendig,
  };
}
