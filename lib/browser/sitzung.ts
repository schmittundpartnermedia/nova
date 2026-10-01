import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Frame, type Locator, type Page } from "playwright-core";
import { novaHomeDir } from "@/lib/gedaechtnis/paths";
import { asUntrustedDataBlock, wrapExternalContent } from "@/lib/research/injection";

/**
 * NOVAs Browser für Plattform-Einträge (Phase 7): Joachims Chrome mit EIGENEM Profil (~/Nova/browser-profil),
 * sichtbar, damit Joachim Captchas und Bestätigungen selbst erledigen kann. Kein Zugriff auf sein normales Chrome-Profil.
 * Die Seite wird als Text gelesen; jedes Bedienelement bekommt eine Nummer (ref), über die NOVA ausfüllt und klickt.
 * Passwörter: nur über den Platzhalter {{passwort}}, der hier aus dem Schlüsselbund aufgelöst wird – nie im Text.
 */

export type Feld = {
  ref: string;
  art: "eingabe" | "auswahl" | "text" | "haken" | "option" | "datei";
  typ: string;
  beschriftung: string;
  name: string;
  pflicht: boolean;
  wert: string;
  optionen?: string[];
};
export type Knopf = { ref: string; text: string; art: "knopf" | "link"; ziel?: string };
export type SeitenStand = {
  url: string;
  titel: string;
  text: string;
  felder: Feld[];
  knoepfe: Knopf[];
  /** Hinweise auf Dinge, die nur ein Mensch erledigen kann (Captcha, Zwei-Faktor). */
  hinweise: string[];
};

export type PasswortQuelle = () => Promise<string | null>;

/** refs: welche Nummer in welchem Rahmen (iframe) steht – Formulare stecken oft in eingebetteten Rahmen. */
type Sitzung = { context: BrowserContext; page: Page; refs: Map<string, Frame> };
type Starter = () => Promise<BrowserContext>;

const globalRef = globalThis as unknown as { __novaBrowser?: Sitzung; __novaBrowserStarter?: Starter };

export function browserProfilDir(): string {
  return path.join(novaHomeDir(), "browser-profil");
}

export function assetsDir(): string {
  return path.join(novaHomeDir(), "assets");
}

/** Standard: sichtbares Chrome mit NOVAs eigenem Profil. Tests setzen einen eigenen Starter (unsichtbar, Wegwerf-Profil). */
const echterStarter: Starter = async () => {
  fs.mkdirSync(browserProfilDir(), { recursive: true });
  return chromium.launchPersistentContext(browserProfilDir(), {
    channel: "chrome",
    headless: false,
    viewport: null,
    locale: "de-DE",
    args: ["--no-first-run", "--no-default-browser-check"],
  });
};

export function setzeBrowserStarter(starter: Starter | null): void {
  globalRef.__novaBrowserStarter = starter ?? undefined;
}

async function sitzung(): Promise<Sitzung> {
  const vorhanden = globalRef.__novaBrowser;
  // Ein Fenster aus einer älteren Programmversion hat noch keine Rahmen-Zuordnung.
  if (vorhanden && !vorhanden.refs) vorhanden.refs = new Map();
  if (vorhanden && !vorhanden.page.isClosed()) return vorhanden;
  const context = vorhanden?.context ?? (await (globalRef.__novaBrowserStarter ?? echterStarter)());
  context.on("close", () => {
    if (globalRef.__novaBrowser?.context === context) globalRef.__novaBrowser = undefined;
  });
  const page = context.pages()[0] ?? (await context.newPage());
  globalRef.__novaBrowser = { context, page, refs: new Map() };
  return globalRef.__novaBrowser;
}

export async function schliesseBrowser(): Promise<void> {
  const vorhanden = globalRef.__novaBrowser;
  globalRef.__novaBrowser = undefined;
  await vorhanden?.context.close().catch(() => undefined);
}

export async function oeffneSeite(url: string): Promise<SeitenStand> {
  // Nur Webseiten. Lokale Dateien (file://) nur im Test – sonst könnte eine Seite NOVA dazu bringen, Dateien vom Mac zu lesen.
  const lokalErlaubt = process.env.NOVA_BROWSER_TESTSEITEN === "1" && /^file:\/\//i.test(url);
  if (!/^https?:\/\//i.test(url) && !lokalErlaubt) throw new Error("Nur http(s)-Adressen.");
  const { page } = await sitzung();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  return leseSeite();
}

/** Läuft in der Seite: vergibt Nummern (data-nova-ref) und sammelt Felder, Knöpfe, Text, iframes. */
const SEITEN_SKRIPT = String.raw`((praefix) => {
  const sichtbar = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (r.width > 0 || r.height > 0) && s.visibility !== "hidden" && s.display !== "none";
  };
  const wurzelVon = (el) => el.getRootNode ? el.getRootNode() : document;
  const beschriftung = (el) => {
    const id = el.getAttribute("id");
    const wurzel = wurzelVon(el);
    const fuer = id && wurzel.querySelector ? wurzel.querySelector('label[for="' + CSS.escape(id) + '"]') : null;
    const umschliessend = el.closest("label");
    const beschrieben = el.getAttribute("aria-labelledby");
    const ueber = beschrieben && wurzel.getElementById ? wurzel.getElementById(beschrieben.split(" ")[0]) : null;
    return (el.getAttribute("aria-label") || (fuer && fuer.textContent) || (umschliessend && umschliessend.textContent) ||
      (ueber && ueber.textContent) || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "")
      .replace(/\s+/g, " ").trim().slice(0, 120);
  };
  // Alle Elemente, auch in offenen Shadow-DOM-Bäumen (Web-Komponenten).
  const alle = [];
  const sammle = (wurzel) => {
    for (const el of Array.from(wurzel.querySelectorAll("*"))) {
      alle.push(el);
      if (el.shadowRoot) sammle(el.shadowRoot);
    }
  };
  sammle(document);
  let n = 0;
  alle.forEach((el) => el.removeAttribute && el.removeAttribute("data-nova-ref"));
  const felder = [];
  const knoepfe = [];
  const passt = (el) => el.matches && el.matches("input, select, textarea, button, a[href], [role=button], [role=checkbox], [role=combobox], [contenteditable=true]");
  for (const el of alle.filter(passt)) {
    const istDatei = el instanceof HTMLInputElement && el.type === "file";
    if (!sichtbar(el) && !istDatei) continue;
    if (el instanceof HTMLInputElement && el.type === "hidden") continue;
    const ref = praefix + String(++n);
    el.setAttribute("data-nova-ref", ref);
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el.getAttribute("contenteditable") === "true") {
      const typ = el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement ? "select" : "textarea";
      if (typ === "submit" || typ === "button" || typ === "image") {
        knoepfe.push({ ref, text: el.value || beschriftung(el), art: "knopf" });
        continue;
      }
      // Passwörter werden nie ausgelesen.
      const roh = el.value == null ? el.textContent || "" : el.value;
      const wert = typ === "password" ? (roh ? "(ausgefüllt)" : "")
        : typ === "checkbox" || typ === "radio" ? (el.checked ? "ja" : "nein")
        : String(roh).slice(0, 200);
      felder.push({
        ref, typ, name: el.getAttribute("name") || "", beschriftung: beschriftung(el), pflicht: !!el.required || el.getAttribute("aria-required") === "true", wert,
        optionen: el instanceof HTMLSelectElement ? Array.from(el.options).map((o) => o.text.trim()).slice(0, 60) : undefined,
      });
    } else {
      const text = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 80);
      if (!text) continue;
      knoepfe.push({ ref, text, art: el.tagName === "A" ? "link" : "knopf", ziel: el.getAttribute("href") || undefined });
    }
  }
  const text = ((document.body && document.body.innerText) || "").replace(/\n{3,}/g, "\n\n").slice(0, 7000);
  return { titel: document.title, text, felder, knoepfe: knoepfe.slice(0, 120) };
})`;

type RahmenRoh = { titel: string; text: string; felder: Array<Record<string, unknown>>; knoepfe: Array<Record<string, unknown>> };

/** Ist dieser eingebettete Rahmen sichtbar groß genug, um etwas Bedienbares zu enthalten? */
async function rahmenSichtbar(frame: Frame): Promise<{ breite: number; hoehe: number } | null> {
  const element = await frame.frameElement().catch(() => null);
  const box = element ? await element.boundingBox().catch(() => null) : null;
  return box && box.width >= 40 && box.height >= 20 ? { breite: box.width, hoehe: box.height } : null;
}

/** Ein sichtbares Captcha zum Anklicken – unsichtbare Prüfungen (reCAPTCHA v3, „size=invisible“) zählen nicht. */
function istSichtbaresCaptcha(url: string, groesse: { breite: number; hoehe: number } | null): boolean {
  if (!groesse || !/recaptcha|hcaptcha|turnstile|challenges\.cloudflare|captcha/i.test(url)) return false;
  if (/size=invisible|recaptcha\/api2\/bframe/i.test(url) && groesse.hoehe < 100) return false;
  return groesse.breite >= 150 && groesse.hoehe >= 60;
}

async function leseEinmal(sitz: Sitzung): Promise<SeitenStand> {
  const { page } = sitz;
  sitz.refs.clear();
  const felder: Feld[] = [];
  const knoepfe: Knopf[] = [];
  const texte: string[] = [];
  const hinweise: string[] = [];
  let titel = "";
  let captcha = false;
  const frames = page.frames();
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const hauptseite = frame === page.mainFrame();
    const groesse = hauptseite ? null : await rahmenSichtbar(frame);
    if (!hauptseite && istSichtbaresCaptcha(frame.url(), groesse)) captcha = true;
    if (!hauptseite && !groesse) continue;
    const praefix = hauptseite ? "" : `r${i}-`;
    // Als Text übergeben: Der TypeScript-Übersetzer würde in eine Funktion Hilfscode einbauen, den die Seite nicht kennt.
    const roh = (await frame.evaluate(`${SEITEN_SKRIPT}(${JSON.stringify(praefix)})`).catch(() => null)) as RahmenRoh | null;
    if (!roh) continue;
    if (hauptseite) titel = roh.titel;
    for (const f of roh.felder) {
      const typ = String(f.typ);
      sitz.refs.set(String(f.ref), frame);
      felder.push({
        ref: String(f.ref),
        art: typ === "select" ? "auswahl" : typ === "textarea" ? "text" : typ === "checkbox" ? "haken" : typ === "radio" ? "option" : typ === "file" ? "datei" : "eingabe",
        typ,
        beschriftung: String(f.beschriftung),
        name: String(f.name),
        pflicht: Boolean(f.pflicht),
        wert: String(f.wert),
        ...(Array.isArray(f.optionen) ? { optionen: f.optionen as string[] } : {}),
      });
    }
    for (const k of roh.knoepfe) {
      sitz.refs.set(String(k.ref), frame);
      knoepfe.push(k as Knopf);
    }
    if (roh.text.trim()) texte.push(hauptseite ? roh.text : `[eingebetteter Rahmen ${frame.url().slice(0, 80)}]\n${roh.text.slice(0, 3000)}`);
  }
  const alleTexte = texte.join("\n\n");
  if (captcha || /ich bin kein roboter|i'm not a robot/i.test(alleTexte)) {
    hinweise.push("Sichtbares Captcha auf der Seite – das muss Joachim lösen (browser_braucht_nutzer).");
  }
  if (/bestätigungs(code|mail)|verification code|code eingeben|zwei-faktor|2fa|one-time code/i.test(alleTexte)) {
    hinweise.push("Die Seite will einen Code oder eine Bestätigung – Joachim fragen (browser_braucht_nutzer).");
  }
  return {
    url: page.url(),
    titel,
    // Seitentext ist fremder Inhalt: Daten, keine Anweisungen.
    text: asUntrustedDataBlock(wrapExternalContent(page.url(), alleTexte)),
    felder,
    knoepfe: knoepfe.slice(0, 150),
    hinweise,
  };
}

/** Liest die aktuelle Seite samt sichtbarer eingebetteter Rahmen: Text, Felder und Knöpfe mit Nummern. */
export async function leseSeite(): Promise<SeitenStand> {
  const sitz = await sitzung();
  const stand = await leseEinmal(sitz);
  if (stand.felder.length) return stand;
  // Formulare laden oft verzögert nach (Skripte, eingebettete Rahmen): kurz warten und noch einmal lesen.
  await sitz.page.waitForTimeout(2500);
  return leseEinmal(sitz);
}

async function finde(ref: string): Promise<Locator> {
  const sitz = await sitzung();
  const sauber = ref.trim().replace(/[^a-z0-9-]/gi, "");
  const frame = sitz.refs.get(sauber) ?? sitz.page.mainFrame();
  const ziel = frame.locator(`[data-nova-ref="${sauber}"]`);
  if (!(await ziel.count())) throw new Error(`Element ${ref} gibt es nicht (Seite neu lesen).`);
  return ziel;
}

/**
 * Füllt Felder aus. Besondere Werte: {{passwort}} (aus dem Schlüsselbund, nur in Passwortfelder),
 * {{datei:<name>}} (nur Dateien aus ~/Nova/assets/, z. B. das Logo), „ja“/„nein“ für Haken, Optionstext für Auswahllisten.
 */
export async function fuelleAus(eintraege: Array<{ ref: string; wert: string }>, passwort: PasswortQuelle): Promise<string[]> {
  const erledigt: string[] = [];
  for (const { ref, wert } of eintraege) {
    const feld = await finde(ref);
    const typ = await feld.evaluate((el) => (el instanceof HTMLInputElement ? el.type : el instanceof HTMLSelectElement ? "select" : el.tagName.toLowerCase()));
    if (wert.includes("{{passwort}}")) {
      if (typ !== "password") throw new Error(`{{passwort}} gehört nur in ein Passwortfeld, Feld ${ref} ist „${typ}“.`);
      const geheim = await passwort();
      if (!geheim) throw new Error("Kein Passwort im Schlüsselbund – erst zugangsdaten_speichern.");
      await feld.fill(geheim);
      erledigt.push(`${ref}: Passwort aus dem Schlüsselbund`);
      continue;
    }
    if (typ === "password") throw new Error(`In Passwortfelder nur {{passwort}} (Feld ${ref}).`);
    const datei = wert.match(/^\{\{datei:(.+)\}\}$/)?.[1];
    if (typ === "file" || datei) {
      const name = path.basename(datei ?? wert);
      const pfad = path.join(assetsDir(), name);
      if (!fs.existsSync(pfad)) throw new Error(`Datei „${name}“ liegt nicht in ~/Nova/assets/.`);
      await feld.setInputFiles(pfad);
      erledigt.push(`${ref}: Datei ${name}`);
      continue;
    }
    if (typ === "checkbox" || typ === "radio") {
      if (/^(ja|an|true|x)$/i.test(wert.trim())) await feld.check();
      else await feld.uncheck().catch(() => undefined);
      erledigt.push(`${ref}: ${wert}`);
      continue;
    }
    if (typ === "select") {
      await feld.selectOption({ label: wert }).catch(async () => feld.selectOption(wert));
      erledigt.push(`${ref}: ${wert}`);
      continue;
    }
    await feld.fill(wert);
    erledigt.push(`${ref}: ${wert.slice(0, 60)}`);
  }
  return erledigt;
}

export async function klicke(ref: string): Promise<SeitenStand> {
  const { page } = await sitzung();
  const ziel = await finde(ref);
  await ziel.click({ timeout: 10_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  return leseSeite();
}
