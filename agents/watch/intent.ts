export function detectWatchIntent(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (/was hatten wir|beschlossen|stand im angebot/i.test(value)) return false;
  return /\b(was steht an|was ist offen|überfällig|follow-?ups?|woran muss ich denken|schau nach aufgaben|offene fristen|deadlines?|watch[-\s]?hinweis|hinweis(?:e)? vom watch|watch[-\s]?scan)\b/i.test(
    value,
  );
}
