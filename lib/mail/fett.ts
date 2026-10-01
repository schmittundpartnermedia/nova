/**
 * Fettdruck in Mails: Vorlagen und Kopf markieren Wichtiges mit **so**.
 * Beim Senden werden daraus <strong>-Stellen in der HTML-Fassung; die Textfassung kommt ohne Sternchen.
 * Bereiche (für die Chat-Karte) sind 1-basiert und inklusiv in UTF-16-Zeichen.
 */
export type FettBereich = { von: number; bis: number };

export function zerlegeFett(markiert: string): { text: string; fett: FettBereich[] } {
  const fett: FettBereich[] = [];
  let text = "";
  let rest = markiert;
  for (;;) {
    const start = rest.indexOf("**");
    const ende = start < 0 ? -1 : rest.indexOf("**", start + 2);
    if (start < 0 || ende < 0) break;
    text += rest.slice(0, start);
    const inhalt = rest.slice(start + 2, ende);
    if (inhalt.trim()) fett.push({ von: text.length + 1, bis: text.length + inhalt.length });
    text += inhalt;
    rest = rest.slice(ende + 2);
  }
  return { text: text + rest, fett };
}

/** Nur Text, ohne Sternchen (Betreff, Suche im Gesendet-Ordner). */
export function ohneFett(markiert: string): string {
  return zerlegeFett(markiert).text;
}
