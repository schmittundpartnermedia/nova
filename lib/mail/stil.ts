/**
 * Stilregel für alles, was NOVA als Mail herausgibt (Joachims Vorgabe 30.09.2026): keine Gedankenstriche.
 * Gemeint sind Halbgeviert- und Geviertstrich (– —); der normale Bindestrich (-) in Wörtern wie „Baden-Württemberg“ bleibt.
 */
const GEDANKENSTRICH = /[–—]/;

export function gedankenstrichIn(text: string): boolean {
  return GEDANKENSTRICH.test(text);
}

/** Für eingesetzte Werte (z. B. Firmennamen aus dem Scanner): Gedankenstrich wird zum Bindestrich. */
export function ohneGedankenstrich(wert: string): string {
  return wert.replace(/[–—]/g, "-");
}
