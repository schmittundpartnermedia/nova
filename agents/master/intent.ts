import { needsLiveResearch } from "@/lib/research/intent";

/**
 * Spezialisten (Recherche, Mail, Aufgabe, Memory-Schreiben) brauchen den Planer.
 * Gespräch, Status, Rückfragen gehen direkt in die gestreamte Antwort.
 */
export function needsSpecialistWork(userRequest: string): boolean {
  const text = userRequest.trim();
  if (!text) return false;
  if (needsLiveResearch(text)) return true;
  if (/\b(?:merk(?:e)?\s+dir|merke\s+dir\s+das|speichere\s+das|behalte\s+das)\b/i.test(text)) return true;
  if (/\b(?:e-?mails?|anschreiben)\b/i.test(text)) return true;
  if (/\b(?:aufgabe|wiedervorlage|todos?)\b/i.test(text) && /erstell|anleg|setz|mach(?:e|en)?|neue[nrs]?\s+(?:aufgabe|todo)/i.test(text)) {
    return true;
  }
  if (/\bprojekt\b/i.test(text) && /erstell|anleg|neue[s]?\s+projekt|übersicht|uebersicht|\bliste\b|\bstatus\b/i.test(text)) {
    return true;
  }
  return false;
}
