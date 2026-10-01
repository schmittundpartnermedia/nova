/**
 * Nachweis Phase 7 (echte API, echte Websuche, OHNE echte Plattform, OHNE Joachims Schlüsselbund und Bildschirm):
 * 1. „Such mir die Plattformen …“ → NOVA recherchiert im Web und legt die Liste an.
 * 2. Registrierung auf einer lokalen Testseite (unsichtbares Chrome, Wegwerf-Profil): Zugangsdaten in einen
 *    Schlüsselbund im Speicher, Felder aus dem Gedächtnis, {{passwort}}, Absenden, Captcha → Joachim wird gerufen.
 * Prüft außerdem, dass das Passwort nirgends im Gesprächsverlauf oder Werkzeugprotokoll steht.
 * Ausgabe: docs/nachweis-phase7.txt
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wegwerfDatenbank } from "./lib/wegwerf-db";

// Deutsche Zeit wie auf dem Server (pm2: TZ=Europe/Berlin), unabhängig vom Rechner, auf dem der Test läuft.
process.env.TZ = "Europe/Berlin";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-nachweis-p7-"));
for (const line of fs.readFileSync(path.join(process.cwd(), ".env"), "utf8").split("\n")) {
  const match = line.match(/^\s*OPENAI_API_KEY\s*=\s*"?([^"\n]*)"?/);
  if (match && !process.env.OPENAI_API_KEY) process.env.OPENAI_API_KEY = match[1];
}
process.env.NOVA_HOME = path.join(tmp, "home");
process.env.NOVA_BROWSER_TESTSEITEN = "1";
const lines: string[] = [];
const log = (line = "") => {
  lines.push(line);
  console.log(line);
};
const check = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
  log(`  ✓ ${message}`);
};

const SEITE = `<!doctype html><html><head><title>Testverzeichnis – Firma eintragen</title></head><body>
<h1>Software eintragen</h1>
<form id="f">
  <label for="firma">Name der Software / Firma</label><input id="firma" name="firma" required>
  <label for="web">Website</label><input id="web" name="web" required>
  <label for="mail">E-Mail</label><input id="mail" type="email" name="mail" required>
  <label for="pw">Passwort</label><input id="pw" type="password" name="pw" required>
  <label for="kat">Kategorie</label><select id="kat"><option>Bitte wählen</option><option>SEO-Software</option><option>CRM</option></select>
  <label for="txt">Kurzbeschreibung</label><textarea id="txt" name="txt"></textarea>
  <label><input type="checkbox" name="agb" required> Ich akzeptiere die AGB</label>
  <button type="submit">Konto anlegen</button>
</form>
<script>
document.getElementById("f").addEventListener("submit", (e) => {
  e.preventDefault();
  document.title = "Bestätigung";
  document.body.innerHTML = '<h1>Fast geschafft</h1><p>Bitte bestätigen Sie, dass Sie kein Roboter sind.</p>' +
    '<iframe src="https://www.google.com/recaptcha/api2/anchor?k=test" width="300" height="80"></iframe><button>Weiter</button>';
});
</script></body></html>`;

async function main() {
  wegwerfDatenbank();
  const home = process.env.NOVA_HOME!;
  fs.mkdirSync(path.join(home, "gedaechtnis"), { recursive: true });
  fs.writeFileSync(
    path.join(home, "gedaechtnis", "firma.md"),
    "# Firma\n\n- Unsere Firma heißt rankPilot (rankpilot.de), Stuttgart. Wir machen Lokal-SEO: eine Online-Marketing-Plattform, die die Sichtbarkeit von KMU bei Google, Google Maps und in KI-Suchen analysiert und verbessert.\n- Für Plattform-Einträge: E-Mail info@rankpilot.de, Kategorie SEO-Software.\n",
  );
  fs.mkdirSync(path.join(tmp, "seiten"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "seiten", "eintragen.html"), SEITE);

  const { chromium } = await import("playwright-core");
  const { setzeBrowserStarter, schliesseBrowser } = await import("@/lib/browser/sitzung");
  const { setzeSchluesselbund } = await import("@/lib/zugangsdaten");
  setzeBrowserStarter(() => chromium.launchPersistentContext(path.join(tmp, "profil"), { channel: "chrome", headless: true }));
  const bund = new Map<string, { konto: string; passwort: string }>();
  setzeSchluesselbund({
    async speichere(dienst, konto, passwort) { bund.set(dienst, { konto, passwort }); },
    async konto(dienst) { return bund.get(dienst)?.konto ?? null; },
    async passwort(dienst) { return bund.get(dienst)?.passwort ?? null; },
  });

  const { prisma } = await import("@/lib/prisma");
  const { runHeadLoop, verlaufsInhalt } = await import("@/agents/master/head");
  const { OpenAIProvider } = await import("@/providers/ai/openai");
  const { HEAD_MODEL } = await import("@/providers/ai/models");
  const org = await prisma.organization.create({ data: { name: "Nachweis", slug: `nachweis-${Date.now()}` } });
  const postfach = {
    neueste: async () => [], eingang: async () => [], lesen: async () => null,
    senden: async () => ({ ok: false as const, executed: false as const, grund: "" }), antworten: async () => ({ ok: false as const, executed: false as const, grund: "" }),
  };
  const context = { organizationId: org.id, postfach };
  const provider = new OpenAIProvider();
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  const protokoll: string[] = [];
  const sag = async (satz: string) => {
    const result = await runHeadLoop({ provider, model: HEAD_MODEL, history, userRequest: satz, context });
    log();
    log(`Joachim: ${satz}`);
    log(`Werkzeuge: ${JSON.stringify(result.toolsExecuted.map((t) => t.name))}`);
    log(`NOVA: ${result.reply}`);
    const inhalt = verlaufsInhalt(result.reply, result.werkzeugNotiz);
    history.push({ role: "user", content: satz }, { role: "assistant", content: inhalt });
    protokoll.push(inhalt);
    return result;
  };

  log(`NOVA Nachweis Phase 7 – ${new Date().toISOString()} – Modell ${HEAD_MODEL}; echte Websuche; lokale Testseite statt echter Plattform; Schlüsselbund im Speicher; unsichtbares Chrome`);

  const t1 = await sag("Such mir die Plattformen, auf denen rankpilot eingetragen sein sollte.");
  check(t1.toolsExecuted.some((t) => t.name === "web_suchen"), "recherchiert im Web");
  const liste = await prisma.plattform.findMany({ where: { organizationId: org.id } });
  check(liste.length >= 3, `Plattformliste angelegt (${liste.length}: ${liste.map((p) => p.name).join(", ")})`);

  // Damit keine echte Plattform angefasst wird: eine lokale Testseite in die Liste, die NOVA dann bearbeitet.
  // Das Werkzeug nimmt zu Recht nur http(s)-Adressen an; die lokale Testseite kommt darum direkt in die Tabelle.
  await prisma.plattform.create({
    data: { organizationId: org.id, name: "Testverzeichnis", url: `file://${path.join(tmp, "seiten", "eintragen.html")}`, kategorie: "Software-Verzeichnis", begruendung: "Nachweis", reihenfolge: 0 },
  });
  log("(Nachweis: lokale Testseite „Testverzeichnis“ in die Liste aufgenommen)");

  const t2 = await sag("Fang mit dem Testverzeichnis an und leg dort das Konto für rankpilot an.");
  const namen = t2.toolsExecuted.map((t) => t.name);
  check(namen.includes("zugangsdaten_speichern"), "legt die Zugangsdaten im Schlüsselbund an");
  check(namen.includes("browser_ausfuellen") && namen.includes("browser_klicken"), "füllt aus und sendet ab");
  check(bund.has("NOVA: Testverzeichnis"), "Eintrag „NOVA: Testverzeichnis“ im Schlüsselbund");
  check(namen.includes("browser_braucht_nutzer"), "erkennt das Captcha und ruft Joachim");
  check(/captcha|roboter/i.test(t2.reply), "sagt Joachim, dass er das Captcha lösen soll");
  const p = await prisma.plattform.findFirstOrThrow({ where: { organizationId: org.id, name: "Testverzeichnis" } });
  check(p.status === "wartet_auf_joachim", `Liste zeigt den Stand (${p.status}, nächster Schritt: ${p.naechsterSchritt})`);
  const geheim = bund.get("NOVA: Testverzeichnis")!.passwort;
  check(!protokoll.join("\n").includes(geheim) && !t2.reply.includes(geheim), "Passwort steht weder in Antwort noch Verlauf noch Werkzeugprotokoll");

  log();
  log("ERGEBNIS: Nachweis Phase 7 bestanden (echte API und Websuche, lokale Testseite, Schlüsselbund im Speicher).");
  log("Nicht geprüft: echte Plattform, echter macOS-Schlüsselbund, sichtbares Chrome – das ist Joachims Abnahme.");
  await schliesseBrowser();
  await prisma.$disconnect();
}

main()
  .catch((error) => {
    log(`FEHLER: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { schliesseBrowser } = await import("@/lib/browser/sitzung");
    await schliesseBrowser().catch(() => undefined);
    fs.writeFileSync(path.join(process.cwd(), "docs", "nachweis-phase7.txt"), `${lines.join("\n")}\n`, "utf8");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
