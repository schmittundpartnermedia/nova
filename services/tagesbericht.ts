import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";
import { meldeNutzer } from "@/services/meldungen";

/**
 * Tagesbericht: alles, was NOVA an einem Tag nach außen getan hat – als Archivdatei ~/Nova/berichte/<datum>.md
 * und (auf Wunsch) als Meldung im Chat. Quelle ist nur die Datenbank, nichts wird geschätzt außer den Scanner-Kosten.
 */

function tagesgrenzen(datum: string) {
  const von = new Date(`${datum}T00:00:00`);
  const bis = new Date(von.getTime() + 86_400_000);
  return { von, bis };
}

function zeit(date: Date | null | undefined): string {
  return date ? date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–";
}

export function berichteDir(): string {
  return path.join(novaHomeDir(), "berichte");
}

export async function schreibeTagesbericht(input: { organizationId: string; datum: string; melden: boolean }) {
  const { organizationId, datum } = input;
  const { von, bis } = tagesgrenzen(datum);

  const gesendet = await prisma.communication.findMany({
    where: { organizationId, direction: "outbound", status: "sent", sentAt: { gte: von, lt: bis } },
    include: { campaign: true },
    orderBy: { sentAt: "asc" },
  });
  const fehlgeschlagen = await prisma.communication.findMany({
    where: { organizationId, direction: "outbound", deliveryStatus: "FAILED", updatedAt: { gte: von, lt: bis } },
    orderBy: { updatedAt: "asc" },
  });
  const eingang = await prisma.communication.findMany({
    where: { organizationId, direction: "inbound", createdAt: { gte: von, lt: bis } },
    orderBy: { createdAt: "asc" },
  });
  // Echte Antworten getrennt von Abwesenheitsnotizen und Rückläufern (Unzustellbar-Meldungen).
  const antworten = eingang.filter((mail) => mail.status !== "autoreply" && mail.status !== "bounce");
  const abwesend = eingang.filter((mail) => mail.status === "autoreply");
  const rueck = eingang.filter((mail) => mail.status === "bounce");
  const suchen = await prisma.workItem.findMany({
    where: { organizationId, kind: { in: ["scanner.lauf", "tagesbetrieb.suche"] }, createdAt: { gte: von, lt: bis } },
    orderBy: { createdAt: "asc" },
  });
  const leadsNeu = await prisma.lead.count({ where: { organizationId, createdAt: { gte: von, lt: bis } } });
  const verworfen = await prisma.lead.findMany({
    where: { organizationId, status: "verworfen", geprueftAt: { gte: von, lt: bis } },
  });
  const gruende = new Map<string, number>();
  for (const lead of verworfen) {
    const grund = (lead.grund ?? "ohne Grund").replace(/\(.*\)/, "").trim();
    gruende.set(grund, (gruende.get(grund) ?? 0) + 1);
  }
  const kombis = suchen.reduce((summe, item) => {
    const audit = item.audit ?? "";
    return summe + Number(audit.match(/(\d+) Kombi/)?.[1] ?? 0);
  }, 0);

  const zeilen: string[] = [];
  zeilen.push(`# NOVA Tagesbericht ${datum}`, "");
  zeilen.push(
    `**Kurz:** ${gesendet.length} Mails gesendet, ${fehlgeschlagen.length} fehlgeschlagen, ${antworten.length} Antworten eingegangen, ` +
      `${abwesend.length} Abwesenheitsnotizen, ${rueck.length} Rückläufer, ` +
      `${suchen.length} Kundensuchen, ${leadsNeu} neue Betriebe, ${verworfen.length} Adressen verworfen.`,
    "",
  );
  zeilen.push("## Gesendete Mails", "");
  if (gesendet.length) {
    zeilen.push("| Zeit | Firma | An | Betreff | Kampagne |", "|---|---|---|---|---|");
    for (const mail of gesendet) {
      zeilen.push(`| ${zeit(mail.sentAt)} | ${mail.recipientName ?? ""} | ${mail.toAddress ?? ""} | ${mail.subject.replace(/\|/g, "/")} | ${mail.campaign?.name ?? "einzeln"}${mail.nachfassZu ? " (Nachfass)" : ""} |`);
    }
  } else zeilen.push("Keine.");
  zeilen.push("", "## Fehlgeschlagen", "");
  if (fehlgeschlagen.length) {
    for (const mail of fehlgeschlagen) zeilen.push(`- ${zeit(mail.updatedAt)} ${mail.recipientName ?? ""} <${mail.toAddress ?? ""}>: ${mail.externalReference ?? "ohne Grund"}`);
  } else zeilen.push("Keine.");
  zeilen.push("", "## Eingegangene Antworten", "");
  if (antworten.length) {
    for (const mail of antworten) zeilen.push(`- ${zeit(mail.createdAt)} ${mail.recipientName ?? ""} <${mail.fromAddress ?? ""}>: ${mail.subject}`);
  } else zeilen.push("Keine.");
  zeilen.push("", "## Abwesenheitsnotizen", "");
  if (abwesend.length) {
    for (const mail of abwesend) zeilen.push(`- ${zeit(mail.createdAt)} ${mail.recipientName ?? ""} <${mail.fromAddress ?? ""}>: ${mail.subject}`);
  } else zeilen.push("Keine.");
  zeilen.push("", "## Rückläufer (unzustellbar, Adresse gesperrt)", "");
  if (rueck.length) {
    for (const mail of rueck) zeilen.push(`- ${zeit(mail.createdAt)} ${mail.recipientName ?? "unbekannt"}: ${mail.subject}`);
  } else zeilen.push("Keine.");
  zeilen.push("", "## Kundensuchen (Lead-Scanner)", "");
  if (suchen.length) {
    for (const item of suchen) {
      const auftrag = JSON.parse(item.payload || "{}") as { branche?: string; ort?: string; anzahl?: number };
      const was = item.kind === "tagesbetrieb.suche" ? "Tageslauf" : `${auftrag.anzahl ?? "?"} × ${auftrag.branche ?? "?"} in ${auftrag.ort ?? "?"}`;
      zeilen.push(`- ${zeit(item.createdAt)} ${was} – ${item.status}${item.lastError ? `: ${item.lastError}` : ""}`);
    }
    if (kombis) zeilen.push("", `Geschätzte Google-Kosten: mindestens ${(kombis * 0.035).toFixed(2)} $ (${kombis} Suchanfragen à ~0,035 $).`);
  } else zeilen.push("Keine.");
  zeilen.push("", "## Verworfene Adressen", "");
  if (gruende.size) {
    for (const [grund, anzahl] of [...gruende.entries()].sort((a, b) => b[1] - a[1])) zeilen.push(`- ${anzahl} × ${grund}`);
  } else zeilen.push("Keine.");

  fs.mkdirSync(berichteDir(), { recursive: true });
  const datei = path.join(berichteDir(), `${datum}.md`);
  fs.writeFileSync(datei, `${zeilen.join("\n")}\n`, "utf8");

  const kurz =
    `Tagesbericht ${datum}: ${gesendet.length} Mails gesendet, ${fehlgeschlagen.length} fehlgeschlagen, ` +
    `${antworten.length} Antworten, ${rueck.length} Rückläufer, ${leadsNeu} neue Betriebe gefunden, ${verworfen.length} Adressen verworfen. ` +
    `Alles im Detail: ~/Nova/berichte/${datum}.md`;
  if (input.melden) await meldeNutzer({ organizationId, anlass: `tagesbericht:${datum}`, text: kurz });
  return { datei, kurz, gesendet: gesendet.length, fehlgeschlagen: fehlgeschlagen.length, antworten: antworten.length };
}
