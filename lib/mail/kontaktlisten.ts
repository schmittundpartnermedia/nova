import fs from "node:fs";
import path from "node:path";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";

/**
 * Kontaktlisten für Kampagnen: `~/Nova/kampagnen/<name>.csv`, Trenner „;“ oder „,“, erste Zeile = Spaltennamen.
 * Pflichtspalte `email`; alle anderen Spalten (z. B. anrede, firma, bereich) füllen die gleichnamigen Platzhalter.
 */

export type KontaktZeile = { zeile: number; werte: Record<string, string> };

export function kampagnenDir(): string {
  return path.join(novaHomeDir(), "kampagnen");
}

export function kontaktlistenNamen(): string[] {
  const dir = kampagnenDir();
  fs.mkdirSync(dir, { recursive: true });
  return fs
    .readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith(".csv"))
    .map((file) => file.replace(/\.csv$/i, ""))
    .sort();
}

function splitZeile(line: string, trenner: string): string[] {
  const felder: string[] = [];
  let aktuell = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        aktuell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === trenner && !inQuotes) {
      felder.push(aktuell.trim());
      aktuell = "";
    } else {
      aktuell += ch;
    }
  }
  felder.push(aktuell.trim());
  return felder;
}

export function parseKontaktliste(raw: string): KontaktZeile[] {
  const lines = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n").split("\n");
  const kopf = lines[0] ?? "";
  const trenner = kopf.split(";").length >= kopf.split(",").length ? ";" : ",";
  const spalten = splitZeile(kopf, trenner).map((name) => name.toLowerCase());
  const zeilen: KontaktZeile[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const felder = splitZeile(line, trenner);
    const werte: Record<string, string> = {};
    spalten.forEach((name, index) => {
      if (name) werte[name] = felder[index] ?? "";
    });
    zeilen.push({ zeile: i + 1, werte });
  }
  return zeilen;
}

export function leseKontaktliste(name: string): KontaktZeile[] {
  const clean = name.trim().replace(/\.csv$/i, "");
  const file = path.join(kampagnenDir(), `${clean}.csv`);
  if (!clean || path.dirname(file) !== kampagnenDir() || !fs.existsSync(file)) {
    throw new Error(`Kontaktliste „${name}“ gibt es nicht. Vorhanden: ${kontaktlistenNamen().join(", ") || "keine"}.`);
  }
  return parseKontaktliste(fs.readFileSync(file, "utf8"));
}

function csvFeld(value: string): string {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return /[;"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function listenPfad(name: string): string {
  const clean = name.trim().replace(/\.csv$/i, "").replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!clean) throw new Error("Name der Kontaktliste fehlt.");
  return path.join(kampagnenDir(), `${clean}.csv`);
}

/** Schreibt eine Kontaktliste neu (Trenner „;“). Gibt den Listennamen zurück. */
export function schreibeKontaktliste(name: string, spalten: string[], zeilen: Array<Record<string, string>>): string {
  fs.mkdirSync(kampagnenDir(), { recursive: true });
  const file = listenPfad(name);
  const text = [spalten.join(";"), ...zeilen.map((werte) => spalten.map((spalte) => csvFeld(werte[spalte] ?? "")).join(";"))].join("\n");
  fs.writeFileSync(file, `${text}\n`, "utf8");
  return path.basename(file, ".csv");
}

/**
 * Hängt einen Kontakt an eine Liste an (legt sie an, wenn es sie nicht gibt). Neue Spalten werden ergänzt.
 * Eine Adresse, die schon in der Liste steht, wird nicht doppelt aufgenommen.
 */
export function haengeKontaktAn(name: string, werte: Record<string, string>): { liste: string; neu: boolean; anzahl: number } {
  const file = listenPfad(name);
  const liste = path.basename(file, ".csv");
  const bestehend = fs.existsSync(file) ? parseKontaktliste(fs.readFileSync(file, "utf8")) : [];
  const email = (werte.email ?? "").trim().toLowerCase();
  if (email && bestehend.some((zeile) => (zeile.werte.email ?? "").trim().toLowerCase() === email)) {
    return { liste, neu: false, anzahl: bestehend.length };
  }
  const spalten: string[] = [];
  for (const zeile of [...bestehend.map((item) => item.werte), werte]) {
    for (const key of Object.keys(zeile)) if (!spalten.includes(key)) spalten.push(key);
  }
  schreibeKontaktliste(liste, spalten, [...bestehend.map((item) => item.werte), werte]);
  return { liste, neu: true, anzahl: bestehend.length + 1 };
}
