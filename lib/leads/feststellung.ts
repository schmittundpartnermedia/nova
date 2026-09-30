/**
 * Macht aus den Befunden des Lead-Scanners einen Satzteil für die Kunden-Vorlage:
 * „{{#feststellung}}Dabei ist mir aufgefallen, dass {{feststellung}}. …{{/feststellung}}“ (optionaler Abschnitt)
 * Grundlage sind die festen Befund-Texte aus lead-scanner/src/scoring.ts (Spalte `befunde`, getrennt mit „; “).
 * Standard ist ein einziger Befund: der, den ein Handwerker am ehesten versteht (Reihenfolge der Regeln).
 * Ohne verwertbaren Befund bleibt die Feststellung leer – dann fällt der Abschnitt weg, erfunden wird nichts.
 */

type Regel = { beginnt: string; satz: (befund: string) => string | null };

function zahl(befund: string): string | null {
  return befund.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(".", ",") ?? null;
}

// Reihenfolge = Vorrang: was ein Handwerker sofort versteht, zuerst (Joachims Entscheidung 01.10.2026).
const REGELN: Regel[] = [
  {
    beginnt: "nur ",
    satz: (b) => (b.includes("Bewertungen") && zahl(b) ? `Ihr Google-Profil bisher nur ${zahl(b)} Bewertungen hat` : null),
  },
  { beginnt: "keine Website hinterlegt", satz: () => "in Ihrem Google-Unternehmensprofil keine Website hinterlegt ist" },
  {
    beginnt: "Bewertungsschnitt",
    satz: (b) => (zahl(b) ? `Ihr Bewertungsschnitt bei Google aktuell bei ${zahl(b)} Sternen liegt` : null),
  },
  { beginnt: "kein Viewport-Meta", satz: () => "Ihre Website nicht für Smartphones optimiert ist" },
  { beginnt: "kein SSL/HTTPS", satz: () => "Ihre Website ohne sichere HTTPS-Verbindung läuft" },
  {
    beginnt: "langsame Ladezeit",
    satz: (b) => (zahl(b) ? `Ihre Website erst nach ${zahl(b)} Sekunden antwortet` : "Ihre Website spürbar langsam lädt"),
  },
  { beginnt: "keine GMB-Kategorie", satz: () => "in Ihrem Google-Unternehmensprofil keine Kategorie gepflegt ist" },
  { beginnt: "nur eine GMB-Kategorie", satz: () => "in Ihrem Google-Unternehmensprofil nur eine Kategorie gepflegt ist" },
  { beginnt: "keine Meta-Description", satz: () => "Ihre Startseite keine Beschreibung für die Google-Ergebnisse hat" },
  { beginnt: "kein Title-Tag", satz: () => "Ihre Startseite keinen Seitentitel für Google hat" },
  { beginnt: "Title zu lang", satz: () => "der Seitentitel Ihrer Startseite in den Google-Ergebnissen abgeschnitten wird" },
  {
    beginnt: "Website ohne LocalBusiness-Schema",
    satz: () => "Ihre Website Google keine strukturierten Firmendaten wie Adresse und Öffnungszeiten mitliefert",
  },
];

export function feststellungAus(befunde: string | null | undefined, hoechstens = 1): string {
  const liste = (befunde ?? "")
    .split(";")
    .map((befund) => befund.trim())
    .filter(Boolean);
  const saetze: Array<{ rang: number; satz: string }> = [];
  for (const befund of liste) {
    // „nur eine GMB-Kategorie“ vor „nur <Zahl> Bewertungen“ prüfen: längster passender Anfang gewinnt.
    const passend = REGELN.map((regel, rang) => ({ regel, rang }))
      .filter(({ regel }) => befund.startsWith(regel.beginnt))
      .sort((a, b) => b.regel.beginnt.length - a.regel.beginnt.length)[0];
    const satz = passend?.regel.satz(befund);
    if (passend && satz) saetze.push({ rang: passend.rang, satz });
  }
  const gewaehlt = saetze
    .sort((a, b) => a.rang - b.rang)
    .slice(0, hoechstens)
    .map((eintrag) => eintrag.satz);
  // „Ihre Website … und Ihre Website …“ → „Ihre Website … und sie …“
  const subjekt = (satz: string) => satz.split(" ").slice(0, 2).join(" ");
  return gewaehlt
    .map((satz, index) =>
      index > 0 && subjekt(satz) === subjekt(gewaehlt[index - 1]!) && subjekt(satz).startsWith("Ihre ")
        ? `sie ${satz.split(" ").slice(2).join(" ")}`
        : satz,
    )
    .join(" und ");
}
