/**
 * Regressionstest Claude-Aufträge (Phase 5) – ohne echtes Claude Code, ohne echte Projekte, ohne Deploy.
 * Wegwerf-Git-Projekt mit eigenem „origin“ (bare Repo), Test-Claude, das Dateien ändert, Wegwerf-DB und -NOVA_HOME.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { wegwerfDatenbank } from "./lib/wegwerf-db";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-claude-"));
process.env.NOVA_HOME = path.join(tmp, "home");

const origin = path.join(tmp, "origin.git");
const repo = path.join(tmp, "webseite");
const liveMarker = path.join(tmp, "live.txt");
const sh = (cmd: string, cwd = repo) => execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function projektAufsetzen(pruefenOk = true, liveOk = true) {
  fs.mkdirSync(path.join(process.env.NOVA_HOME!, "claude"), { recursive: true });
  fs.writeFileSync(
    path.join(process.env.NOVA_HOME!, "claude", "projekte.json"),
    JSON.stringify([
      {
        name: "webseite",
        beschreibung: "Test-Webseite",
        ordner: repo,
        hauptzweig: "main",
        pruefen: [pruefenOk ? "test -f footer.html" : "exit 3"],
        live: liveOk ? `echo live > ${liveMarker} && echo Deploy fertig` : "echo Server nicht erreichbar && exit 1",
      },
    ]),
  );
}

async function main() {
  wegwerfDatenbank();
  sh(`git init --bare -b main ${origin}`, tmp);
  sh(`git clone ${origin} ${repo}`, tmp);
  sh('git config user.email "test@nova" && git config user.name "Test"');
  fs.writeFileSync(path.join(repo, "footer.html"), "<footer>Tel: 0711 111</footer>\n");
  sh("git add -A && git commit -m start && git push -u origin main");
  projektAufsetzen();

  const { prisma } = await import("@/lib/prisma");
  const { executeTool } = await import("@/services/tools/registry");
  const { fuehreAuftragAus, fuehreLiveAus } = await import("@/services/claude");
  const { holeNeueMeldungen } = await import("@/services/meldungen");
  type ClaudeRunner = import("@/lib/claude/runner").ClaudeRunner;

  const org = await prisma.organization.create({ data: { name: "Test", slug: `t-${Date.now()}` } });
  const keinPostfach = {
    neueste: async () => [], eingang: async () => [], lesen: async () => null,
    senden: async () => ({ ok: false as const, executed: false as const, grund: "x" }),
    antworten: async () => ({ ok: false as const, executed: false as const, grund: "x" }),
  };
  const run = (name: string, args: Record<string, unknown>) => executeTool(name, args, { organizationId: org.id, postfach: keinPostfach });
  const auftraege: string[] = [];
  let lauf = 0;
  const claudeCommittet: ClaudeRunner = async ({ ordner, auftrag }) => {
    auftraege.push(auftrag);
    lauf += 1;
    fs.writeFileSync(path.join(ordner, "footer.html"), `<footer>Tel: 0711 222</footer>\n<!-- Lauf ${lauf} -->\n`);
    execSync('git add -A && git commit -m "Footer: neue Telefonnummer"', { cwd: ordner });
    return { ok: true, text: "Ich habe die Telefonnummer im Footer auf 0711 222 geändert, die Prüfung lief durch.", kostenUsd: 0.12, sessionId: "s1" };
  };
  const neuerAuftrag = async (aufgabe = "Telefonnummer im Footer auf 0711 222 ändern") => {
    const result = await run("claude_beauftragen", { projekt: "webseite", aufgabe, abnahmekriterium: "Footer zeigt 0711 222" });
    assert.equal(result.ok, true, result.error);
    return (result.data as { auftrag_id: string }).auftrag_id;
  };

  const tests: Array<[string, () => Promise<void>]> = [
    ["Mit ungespeicherten Änderungen im Projekt fängt NOVA nichts an", async () => {
      fs.writeFileSync(path.join(repo, "notiz.txt"), "halb fertig");
      const result = await run("claude_beauftragen", { projekt: "webseite", aufgabe: "x", abnahmekriterium: "" });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /ungespeicherte Änderungen/);
      fs.rmSync(path.join(repo, "notiz.txt"));
    }],
    ["Auftrag: Datei + Hintergrund-Job, zweiter Auftrag fürs gleiche Projekt wird abgelehnt", async () => {
      const id = await neuerAuftrag();
      assert.ok(fs.existsSync(path.join(process.env.NOVA_HOME!, "claude", "auftraege", `${id}.md`)));
      assert.equal(await prisma.workItem.count({ where: { kind: "claude.lauf" } }), 1);
      const zweiter = await run("claude_beauftragen", { projekt: "webseite", aufgabe: "noch was", abnahmekriterium: "" });
      assert.match(zweiter.error ?? "", /läuft schon ein Auftrag/);
      const fertig = await fuehreAuftragAus({ auftragId: id, claude: claudeCommittet });
      assert.equal(fertig.status, "fertig", fertig.fehler);
      assert.match(auftraege[0]!, /Telefonnummer im Footer/);
      assert.match(auftraege[0]!, /nicht auf main pushen, nichts veröffentlichen/);
      assert.deepEqual(fertig.dateien, ["footer.html"]);
      assert.equal(sh("git branch --show-current"), "main", "Projekt steht danach wieder auf main");
      assert.match(fs.readFileSync(path.join(repo, "footer.html"), "utf8"), /0711 111/, "main bleibt unverändert bis zur Freigabe");
      const meldungen = await holeNeueMeldungen(org.id);
      assert.equal(meldungen.length, 1);
      assert.match(meldungen[0]!.text, /fertig[\s\S]*alles in Ordnung\. Soll ich es live stellen\?/);
      assert.ok(!/nova\/|`/.test(meldungen[0]!.text), "Meldung ohne Branch-Namen und Code-Formatierung");
      assert.equal(fs.existsSync(liveMarker), false, "nichts veröffentlicht");
    }],
    ["Live nur mit Freigabe genau dieses Auftrags; danach übernommen, gepusht, veröffentlicht", async () => {
      const id = (await run("claude_status", { auftrag_id: "" })).data as { auftraege: Array<{ auftrag_id: string }> };
      const auftragId = id.auftraege[0]!.auftrag_id;
      const frage = await run("claude_live", { auftrag_id: auftragId, freigabe_id: "" });
      assert.equal((frage.data as { status: string }).status, "freigabe_noetig");
      assert.equal(frage.executed, false);
      const falsch = await run("claude_live", { auftrag_id: auftragId, freigabe_id: "falsch" });
      assert.equal(falsch.ok, false);
      const ja = await run("claude_live", { auftrag_id: auftragId, freigabe_id: (frage.data as { freigabe_id: string }).freigabe_id });
      assert.equal((ja.data as { status: string }).status, "wird_live");
      const live = await fuehreLiveAus({ auftragId });
      assert.equal(live.status, "live", live.fehler);
      assert.match(fs.readFileSync(path.join(repo, "footer.html"), "utf8"), /0711 222/);
      assert.match(sh(`git --git-dir=${origin} log main --format=%s`, tmp), /NOVA-Auftrag .* übernommen/);
      assert.ok(fs.existsSync(liveMarker), "Live-Skript lief");
      const meldungen = await holeNeueMeldungen(org.id);
      assert.match(meldungen.at(-1)!.text, /ist live\. Letzte Meldung vom Veröffentlichen: Deploy fertig/);
    }],
    ["Nicht committete Änderungen von Claude übernimmt NOVA selbst", async () => {
      const id = await neuerAuftrag("Footer-Text ergänzen");
      const ohneCommit: ClaudeRunner = async ({ ordner }) => {
        fs.appendFileSync(path.join(ordner, "footer.html"), "<p>Neu</p>\n");
        return { ok: true, text: "Erledigt.", kostenUsd: null, sessionId: null };
      };
      const fertig = await fuehreAuftragAus({ auftragId: id, claude: ohneCommit });
      assert.equal(fertig.status, "fertig", fertig.fehler);
      assert.match(fertig.commits!.join(" "), /offene Änderungen von Claude übernommen/);
      await holeNeueMeldungen(org.id);
    }],
    ["Prüfung fehlgeschlagen: nicht fertig, ehrliche Meldung, live verweigert", async () => {
      projektAufsetzen(false);
      const id = await neuerAuftrag("Noch eine Änderung");
      const fertig = await fuehreAuftragAus({ auftragId: id, claude: claudeCommittet });
      assert.equal(fertig.status, "fehlgeschlagen");
      assert.match(fertig.fehler ?? "", /Prüfung fehlgeschlagen: exit 3/);
      const meldungen = await holeNeueMeldungen(org.id);
      assert.match(meldungen.at(-1)!.text, /nicht fertig geworden[\s\S]*Live gestellt wurde nichts/);
      const live = await run("claude_live", { auftrag_id: id, freigabe_id: "" });
      assert.equal(live.ok, false);
      projektAufsetzen(true);
    }],
    ["Claude scheitert: Auftrag fehlgeschlagen, Projekt wieder auf main", async () => {
      const id = await neuerAuftrag("Etwas Unmögliches");
      const kaputt: ClaudeRunner = async () => ({ ok: false, text: "Ich brauche die neue Nummer.", kostenUsd: null, sessionId: null });
      const ergebnis = await fuehreAuftragAus({ auftragId: id, claude: kaputt });
      assert.equal(ergebnis.status, "fehlgeschlagen");
      assert.equal(sh("git branch --show-current"), "main");
      const meldungen = await holeNeueMeldungen(org.id);
      assert.match(meldungen.at(-1)!.text, /Claude schreibt: Ich brauche die neue Nummer/);
    }],
    ["Live-Skript scheitert: Meldung sagt genau, was schon passiert ist", async () => {
      projektAufsetzen(true, false);
      const id = await neuerAuftrag("Letzte Änderung");
      const einmal: ClaudeRunner = async ({ ordner }) => {
        fs.appendFileSync(path.join(ordner, "footer.html"), "<p>x</p>\n");
        execSync('git add -A && git commit -m "x"', { cwd: ordner });
        return { ok: true, text: "ok", kostenUsd: null, sessionId: null };
      };
      await fuehreAuftragAus({ auftragId: id, claude: einmal });
      const frage = await run("claude_live", { auftrag_id: id, freigabe_id: "" });
      await run("claude_live", { auftrag_id: id, freigabe_id: (frage.data as { freigabe_id: string }).freigabe_id });
      const live = await fuehreLiveAus({ auftragId: id });
      assert.equal(live.status, "live_fehlgeschlagen");
      const meldungen = await holeNeueMeldungen(org.id);
      assert.match(meldungen.at(-1)!.text, /übernommen und gepusht, aber das Veröffentlichen ist fehlgeschlagen/);
    }],
    ["Projekterkennung: alle Git-Ordner, ohne NOVA und Doppel; Prüfbefehle aus package.json; ohne Git gemeldet", async () => {
      const root = path.join(tmp, "projekte");
      fs.mkdirSync(root);
      const neuesRepo = (name: string, scripts: Record<string, string>, remote?: string, commit = true) => {
        const dir = path.join(root, name);
        fs.mkdirSync(dir);
        sh("git init -b main", dir);
        sh('git config user.email "t@n" && git config user.name "T"', dir);
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ description: `${name} Beschreibung`, scripts }));
        if (remote) sh(`git remote add origin ${remote}`, dir);
        if (commit) sh("git add -A && git commit -m start", dir);
      };
      neuesRepo("planexus", { check: "x", build: "x", dev: "x" }, "https://github.com/x/planexus");
      neuesRepo("planexus-kopie", { build: "x" }, "https://github.com/x/planexus");
      neuesRepo("Lokales Ding", { typecheck: "node -e 0" });
      neuesRepo("leer", {}, undefined, false);
      neuesRepo("NOVA", { build: "x" }, "https://github.com/x/nova");
      fs.mkdirSync(path.join(root, "Notizen"));
      const alt = path.join(process.env.NOVA_HOME!, "claude", "projekte.json");
      fs.renameSync(alt, `${alt}.bak`);
      process.env.NOVA_PROJEKTE_DIR = root;
      try {
        const { leseProjekte, ordnerOhneGit, projekt } = await import("@/lib/claude/projekte");
        const liste = leseProjekte();
        assert.deepEqual(liste.map((p) => p.name).sort(), ["leer", "lokales-ding", "planexus"]);
        const planexus = projekt("planexus");
        assert.deepEqual(planexus.pruefen, ["npm run check", "npm run build"]);
        assert.equal(planexus.remote, true);
        assert.equal(planexus.live, null);
        assert.equal(projekt("lokales-ding").remote, false);
        assert.equal(projekt("leer").zustand, "ohne_stand");
        assert.deepEqual(ordnerOhneGit(), ["Notizen"]);
        const ohneStand = await run("claude_beauftragen", { projekt: "leer", aufgabe: "x", abnahmekriterium: "" });
        assert.match(ohneStand.error ?? "", /noch nie etwas gespeichert/);
        // Projekt ohne GitHub und ohne Live-Skript: Branch wird nicht gepusht, „live“ = übernehmen
        const id = (await run("claude_beauftragen", { projekt: "lokales-ding", aufgabe: "README anlegen", abnahmekriterium: "" })).data as { auftrag_id: string };
        const lokal: ClaudeRunner = async ({ ordner, auftrag }) => {
          assert.match(auftrag, /kein GitHub – nichts pushen/);
          fs.writeFileSync(path.join(ordner, "README.md"), "# Neu\n");
          execSync('git add -A && git commit -m "README"', { cwd: ordner });
          return { ok: true, text: "README angelegt.", kostenUsd: null, sessionId: null };
        };
        const fertig = await fuehreAuftragAus({ auftragId: id.auftrag_id, claude: lokal });
        assert.equal(fertig.status, "fertig", fertig.fehler);
        const frage = await run("claude_live", { auftrag_id: id.auftrag_id, freigabe_id: "" });
        await run("claude_live", { auftrag_id: id.auftrag_id, freigabe_id: (frage.data as { freigabe_id: string }).freigabe_id });
        const live = await fuehreLiveAus({ auftragId: id.auftrag_id });
        assert.equal(live.status, "live", live.fehler);
        assert.ok(fs.existsSync(path.join(root, "Lokales Ding", "README.md")), "in main übernommen");
        const meldungen = await holeNeueMeldungen(org.id);
        assert.match(meldungen.at(-1)!.text, /ist übernommen\. Übernommen; das Projekt hat kein GitHub/);
      } finally {
        fs.renameSync(`${alt}.bak`, alt);
        delete process.env.NOVA_PROJEKTE_DIR;
      }
    }],
  ];

  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}`);
      console.log(error instanceof Error ? error.message : error);
    }
  }
  await prisma.$disconnect();
  console.log(failed ? `${failed} von ${tests.length} fehlgeschlagen` : `alle ${tests.length} bestanden`);
  return failed;
}

main()
  .then((failed) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  })
  .catch((error) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.error(error);
    process.exit(1);
  });
