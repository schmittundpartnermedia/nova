import { prisma } from "@/lib/prisma";
import { GOOGLE_USD_PRO_ANFRAGE, leseBuchungen, lesePreise, usdFuer, type VerbrauchsArt } from "@/lib/kosten";
import { alleAuftraege } from "@/services/claude";

/**
 * Kostenübersicht für einen Zeitraum:
 * - OpenAI (Kopf, Stimme, Spracherkennung, Websuche): Verbrauch aus dem Kostenbuch × Preistabelle; ohne Preis „fehlt“.
 * - Claude Code: echte Kosten, die Claude Code je Auftrag meldet.
 * - Google Places: Anfragen der Gebietssuchen × 0,035 $ (Scanner-README).
 */
export type Kostenposten = { posten: string; usd: number | null; menge: string; hinweis?: string };

const ART_NAME: Record<VerbrauchsArt, string> = {
  kopf: "NOVAs Kopf (OpenAI)",
  auswertung: "Auswertung von Websites und Checks (OpenAI)",
  stimme: "Sprachausgabe (OpenAI)",
  spracherkennung: "Spracherkennung (OpenAI)",
  websuche: "Websuche (OpenAI)",
};

export async function kostenUebersicht(input: { organizationId: string; von: Date; bis: Date }) {
  const posten: Kostenposten[] = [];
  const preise = lesePreise();
  const buchungen = leseBuchungen(input.von, input.bis);

  const nachArtModell = new Map<string, { art: VerbrauchsArt; modell: string; usd: number; ohnePreis: boolean; tokensEin: number; tokensAus: number; zeichen: number; sekunden: number; anfragen: number; aufrufe: number }>();
  for (const b of buchungen) {
    const schluessel = `${b.art}|${b.modell}`;
    const e = nachArtModell.get(schluessel) ?? { art: b.art, modell: b.modell, usd: 0, ohnePreis: false, tokensEin: 0, tokensAus: 0, zeichen: 0, sekunden: 0, anfragen: 0, aufrufe: 0 };
    const usd = usdFuer(b, preise);
    if (usd === null) e.ohnePreis = true;
    else e.usd += usd;
    e.tokensEin += b.eingabeTokens ?? 0;
    e.tokensAus += b.ausgabeTokens ?? 0;
    e.zeichen += b.zeichen ?? 0;
    e.sekunden += b.sekunden ?? 0;
    e.anfragen += b.anfragen ?? 0;
    e.aufrufe += 1;
    nachArtModell.set(schluessel, e);
  }
  for (const e of nachArtModell.values()) {
    const menge = [
      e.tokensEin || e.tokensAus ? `${e.tokensEin.toLocaleString("de-DE")} Tokens rein, ${e.tokensAus.toLocaleString("de-DE")} raus` : "",
      e.zeichen ? `${e.zeichen.toLocaleString("de-DE")} Zeichen gesprochen` : "",
      e.sekunden ? `${Math.round(e.sekunden / 60)} Minuten Sprache` : "",
      e.anfragen ? `${e.anfragen} Suchaufrufe` : "",
    ]
      .filter(Boolean)
      .join(", ") || `${e.aufrufe} Aufrufe`;
    posten.push({
      posten: `${ART_NAME[e.art]} – ${e.modell}`,
      usd: e.ohnePreis ? null : e.usd,
      menge,
      ...(e.ohnePreis ? { hinweis: `Preis für ${e.modell} fehlt – in ~/Nova/preise.json eintragen.` } : {}),
    });
  }

  const auftraege = alleAuftraege().filter((a) => a.organizationId === input.organizationId && new Date(a.erstellt) >= input.von && new Date(a.erstellt) < input.bis);
  if (auftraege.length) {
    const bekannt = auftraege.filter((a) => typeof a.kostenUsd === "number");
    posten.push({
      posten: "Claude Code (Programmier-Aufträge)",
      usd: bekannt.reduce((s, a) => s + (a.kostenUsd ?? 0), 0),
      menge: `${auftraege.length} Aufträge`,
      ...(bekannt.length < auftraege.length ? { hinweis: `${auftraege.length - bekannt.length} Auftrag/Aufträge ohne Kostenangabe (z. B. noch laufend).` } : {}),
    });
  }

  const suchen = await prisma.workItem.findMany({
    where: { organizationId: input.organizationId, kind: "scanner.lauf", createdAt: { gte: input.von, lt: input.bis } },
  });
  const anfragen = suchen.reduce((s, item) => s + Number((item.audit ?? "").match(/(\d+) Anfragen/)?.[1] ?? 0), 0);
  if (suchen.length) {
    posten.push({ posten: "Google Places (Kundensuche)", usd: anfragen * GOOGLE_USD_PRO_ANFRAGE, menge: `${anfragen} Anfragen in ${suchen.length} Suchen` });
  }

  const bekannteSumme = posten.reduce((s, p) => s + (p.usd ?? 0), 0);
  const fehlend = posten.filter((p) => p.usd === null).map((p) => p.posten);
  return {
    von: input.von.toISOString(),
    bis: input.bis.toISOString(),
    posten,
    summe_usd: Math.round(bekannteSumme * 100) / 100,
    vollstaendig: fehlend.length === 0,
    ohne_preis: fehlend,
  };
}

export function zeitraum(name: string, jetzt = new Date()): { von: Date; bis: Date } {
  const heute = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  if (name === "7_tage") return { von: new Date(heute.getTime() - 6 * 86_400_000), bis: jetzt };
  if (name === "monat") return { von: new Date(jetzt.getFullYear(), jetzt.getMonth(), 1), bis: jetzt };
  if (name === "vormonat") return { von: new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 1), bis: new Date(jetzt.getFullYear(), jetzt.getMonth(), 1) };
  return { von: heute, bis: jetzt };
}
