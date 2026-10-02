import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";

/**
 * WhatsApp-Vorlagen als Dateien in ~/Nova/vorlagen/whatsapp/<name>.md:
 *
 *   ---
 *   name: kunden_hallo          (Meta-Name: klein, Buchstaben/Ziffern/_)
 *   kategorie: MARKETING        (MARKETING oder UTILITY)
 *   sprache: de
 *   ---
 *   Hallo {{Vorname}}, …
 *
 * Platzhalter im Text: {{Vorname}}. Bei Meta wird daraus {{1}}. Fett in WhatsApp: *so*.
 */

export type WhatsappVorlage = { datei: string; name: string; kategorie: "MARKETING" | "UTILITY"; sprache: string; text: string; platzhalter: string[] };

export function whatsappVorlagenOrdner(): string {
  return path.join(novaHomeDir(), "vorlagen", "whatsapp");
}

export function parseWhatsappVorlage(datei: string, inhalt: string): WhatsappVorlage {
  const m = inhalt.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`Vorlage ${datei}: Kopf (--- name/kategorie/sprache ---) fehlt.`);
  const kopf = Object.fromEntries(
    m[1]!
      .split("\n")
      .map((z) => z.match(/^\s*([a-z]+)\s*:\s*(.+?)\s*$/i))
      .filter((x): x is RegExpMatchArray => !!x)
      .map((x) => [x[1]!.toLowerCase(), x[2]!]),
  );
  const name = String(kopf.name ?? "");
  if (!/^[a-z][a-z0-9_]{0,511}$/.test(name)) throw new Error(`Vorlage ${datei}: name muss klein sein (Buchstaben, Ziffern, _), z. B. kunden_hallo.`);
  const kategorie = String(kopf.kategorie ?? "MARKETING").toUpperCase();
  if (kategorie !== "MARKETING" && kategorie !== "UTILITY") throw new Error(`Vorlage ${datei}: kategorie MARKETING oder UTILITY.`);
  const text = m[2]!.trim();
  if (!text) throw new Error(`Vorlage ${datei}: Text fehlt.`);
  if (text.length > 1024) throw new Error(`Vorlage ${datei}: Text hat ${text.length} Zeichen, Meta erlaubt 1024.`);
  if (/[–—]/.test(text)) throw new Error(`Vorlage ${datei}: Gedankenstrich im Text (Joachims Regel).`);
  const platzhalter = [...new Set([...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((x) => x[1]!))];
  if (platzhalter.some((p) => p !== "Vorname")) throw new Error(`Vorlage ${datei}: nur der Platzhalter {{Vorname}} ist vorgesehen.`);
  return { datei, name, kategorie: kategorie as WhatsappVorlage["kategorie"], sprache: String(kopf.sprache ?? "de"), text, platzhalter };
}

export function leseWhatsappVorlagen(): WhatsappVorlage[] {
  const ordner = whatsappVorlagenOrdner();
  if (!fs.existsSync(ordner)) return [];
  return fs
    .readdirSync(ordner)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseWhatsappVorlage(f, fs.readFileSync(path.join(ordner, f), "utf8")));
}

export function findeWhatsappVorlage(name: string): WhatsappVorlage {
  const v = leseWhatsappVorlagen().find((x) => x.name === name.trim().toLowerCase() || x.datei === `${name.trim()}.md`);
  if (!v) throw new Error(`WhatsApp-Vorlage „${name}“ gibt es nicht in ~/Nova/vorlagen/whatsapp/.`);
  return v;
}

/** Text für Meta: {{Vorname}} → {{1}}. */
export function metaText(v: WhatsappVorlage): string {
  return v.text.replace(/\{\{\s*Vorname\s*\}\}/g, "{{1}}");
}

/** So liest es der Empfänger. */
export function fuelleWhatsapp(v: WhatsappVorlage, vorname: string): string {
  return v.text.replace(/\{\{\s*Vorname\s*\}\}/g, vorname);
}
