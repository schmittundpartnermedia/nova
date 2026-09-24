import { detectResearchIntent, needsLiveResearch } from "@/lib/research/intent";
import { detectKnowledgeIntent } from "@/agents/knowledge/intent";
import { detectChatGPTImportIntent } from "@/lib/chatgpt/intent";
import { detectCodingIntent } from "@/agents/coding/intent";
import { detectComputerIntent } from "@/agents/computer/intent";
import { isPureSocial } from "@/lib/dialog/intent";
import { detectCalendarIntent } from "@/agents/calendar/intent";
import { detectWatchIntent } from "@/agents/watch/intent";

/**
 * Spezialisten (Recherche, Mail, Aufgabe, Memory-Schreiben) brauchen den Planer.
 * Gespräch, Status, Rückfragen gehen direkt in die gestreamte Antwort.
 */
export function needsSpecialistWork(userRequest: string): boolean {
  const text = userRequest.trim();
  if (!text) return false;
  if (isPureSocial(text)) return false;
  const knowledge = detectKnowledgeIntent(text);
  if (detectChatGPTImportIntent(text).kind !== "none") return true;
  if (knowledge.kind === "import") return true;
  if (knowledge.kind === "query") return false;
  if (needsLiveResearch(text) && knowledge.kind === "none") return true;
  if (/\b(?:merk(?:e)?\s+dir|merke\s+dir\s+das|speichere\s+das|behalte\s+das)\b/i.test(text)) return true;
  if (/\b(?:e-?mails?|anschreiben)\b/i.test(text)) return true;
  if (/\b(?:aufgabe|wiedervorlage|todos?)\b/i.test(text) && /erstell|anleg|setz|mach(?:e|en)?|neue[nrs]?\s+(?:aufgabe|todo)/i.test(text)) {
    return true;
  }
  if (/\bprojekt\b/i.test(text) && /erstell|anleg|neue[s]?\s+projekt|übersicht|uebersicht|\bliste\b|\bstatus\b/i.test(text)) {
    return true;
  }
  if (detectCalendarIntent(text)) return true;
  if (detectWatchIntent(text)) return true;
  return false;
}

/**
 * Astra nur wenn NOVA hart arbeiten muss: Programmieren, Computer, tiefe Recherche.
 * Alltag, Dialog und Aktenfragen bleiben auf Sol.
 */
export function needsFlagshipModel(userRequest: string): boolean {
  const text = userRequest.trim();
  if (!text || isPureSocial(text)) return false;
  const coding = detectCodingIntent(text);
  if (coding.kind !== "none" && coding.kind !== "cancel") return true;
  const computer = detectComputerIntent(text);
  if (computer.kind !== "none" && computer.kind !== "cancel") return true;
  if (!needsLiveResearch(text)) return false;
  const research = detectResearchIntent(text);
  return research.deep || research.kind === "company" || research.kind === "deep";
}
