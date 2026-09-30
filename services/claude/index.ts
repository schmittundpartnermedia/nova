import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/services/tenant";
import { createApprovalRequest, decideApproval } from "@/services/approvals";
import { enqueueWorkItem } from "@/services/worker/queue";
import { meldeNutzer } from "@/services/meldungen";
import { claudeDir, projekt, type ClaudeProjekt } from "@/lib/claude/projekte";
import type { ClaudeRunner } from "@/lib/claude/runner";

/**
 * Aufträge an Claude Code (ersetzt Cursor, Entscheidung Joachim 30.09.2026):
 * Auftrag (Datei ~/Nova/claude/auftraege/<id>.md + Stand <id>.json) → Worker „claude.lauf“: eigener Branch nova/<id>,
 * Claude arbeitet und committet, NOVA prüft selbst (Diff, Prüfbefehle) → Meldung mit Frage „live stellen?“ →
 * nach Joachims Ja Worker „claude.live“: in den Hauptzweig übernehmen, pushen, Live-Skript ausführen, melden.
 */

export type AuftragStatus = "geplant" | "laeuft" | "fertig" | "fehlgeschlagen" | "wird_live" | "live" | "live_fehlgeschlagen";

export type Auftrag = {
  id: string;
  organizationId: string;
  projekt: string;
  aufgabe: string;
  abnahmekriterium: string;
  branch: string;
  status: AuftragStatus;
  erstellt: string;
  zusammenfassung?: string;
  kostenUsd?: number | null;
  commits?: string[];
  dateien?: string[];
  pruefung?: Array<{ befehl: string; ok: boolean; ausgabe: string }>;
  fehler?: string;
  live?: { ok: boolean; ausgabe: string; zeit: string };
};

function auftraegeDir(): string {
  return path.join(claudeDir(), "auftraege");
}

function statusDatei(id: string): string {
  return path.join(auftraegeDir(), `${id}.json`);
}

export function leseAuftrag(id: string): Auftrag {
  const file = statusDatei(id.trim());
  if (!/^[a-z0-9-]+$/.test(id.trim()) || !fs.existsSync(file)) throw new Error(`Auftrag „${id}“ gibt es nicht.`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Auftrag;
}

function speichere(auftrag: Auftrag): Auftrag {
  fs.mkdirSync(auftraegeDir(), { recursive: true });
  fs.writeFileSync(statusDatei(auftrag.id), `${JSON.stringify(auftrag, null, 2)}\n`, "utf8");
  return auftrag;
}

export function alleAuftraege(): Auftrag[] {
  if (!fs.existsSync(auftraegeDir())) return [];
  return fs
    .readdirSync(auftraegeDir())
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(fs.readFileSync(path.join(auftraegeDir(), file), "utf8")) as Auftrag)
    .sort((a, b) => b.erstellt.localeCompare(a.erstellt));
}

/** Befehl im Projektordner ausführen (Shell), Ausgabe gekürzt. */
export function fuehreBefehlAus(befehl: string, ordner: string, timeoutMs = 15 * 60_000): Promise<{ ok: boolean; ausgabe: string }> {
  return new Promise((resolve) => {
    const child = spawn("/bin/zsh", ["-lc", befehl], { cwd: ordner, env: { ...process.env, DATABASE_URL: undefined }, stdio: ["ignore", "pipe", "pipe"] });
    let ausgabe = "";
    const sammle = (chunk: Buffer) => {
      ausgabe = (ausgabe + chunk.toString("utf8")).slice(-6000);
    };
    child.stdout.on("data", sammle);
    child.stderr.on("data", sammle);
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, ausgabe: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, ausgabe: ausgabe.trim() });
    });
  });
}

async function git(ordner: string, befehl: string) {
  const result = await fuehreBefehlAus(`git ${befehl}`, ordner, 5 * 60_000);
  if (!result.ok) throw new Error(`git ${befehl.split(" ")[0]}: ${result.ausgabe.split("\n").slice(-2).join(" ")}`);
  return result.ausgabe;
}

async function bereitFuerAuftrag(p: ClaudeProjekt): Promise<void> {
  if (!fs.existsSync(path.join(p.ordner, ".git"))) throw new Error(`${p.ordner} ist kein Git-Projekt.`);
  const offen = (await git(p.ordner, "status --porcelain")).trim();
  if (offen) throw new Error(`Im Projekt ${p.name} gibt es ungespeicherte Änderungen – so fange ich nichts an. Bitte erst committen oder verwerfen.`);
  const zweig = (await git(p.ordner, "branch --show-current")).trim();
  if (zweig !== p.hauptzweig) throw new Error(`Das Projekt ${p.name} steht auf „${zweig}“ statt „${p.hauptzweig}“.`);
}

export async function beauftrageClaude(input: { organizationId: string; projekt: string; aufgabe: string; abnahmekriterium: string }): Promise<Auftrag> {
  assertOrganizationId(input.organizationId);
  const p = projekt(input.projekt);
  if (!input.aufgabe.trim()) throw new Error("Aufgabe fehlt.");
  const laufend = alleAuftraege().find((item) => item.projekt === p.name && (item.status === "geplant" || item.status === "laeuft" || item.status === "wird_live"));
  if (laufend) throw new Error(`Für ${p.name} läuft schon ein Auftrag (${laufend.id}). Erst der, dann der nächste.`);
  await bereitFuerAuftrag(p);
  const id = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  fs.mkdirSync(auftraegeDir(), { recursive: true });
  fs.writeFileSync(
    path.join(auftraegeDir(), `${id}.md`),
    `# Auftrag ${id}\n\nProjekt: ${p.beschreibung} (${p.ordner})\n\n## Aufgabe\n\n${input.aufgabe.trim()}\n\n## Abnahmekriterium\n\n${input.abnahmekriterium.trim() || "(keins genannt)"}\n`,
    "utf8",
  );
  const auftrag = speichere({
    id,
    organizationId: input.organizationId,
    projekt: p.name,
    aufgabe: input.aufgabe.trim(),
    abnahmekriterium: input.abnahmekriterium.trim(),
    branch: `nova/${id}`,
    status: "geplant",
    erstellt: new Date().toISOString(),
  });
  await enqueueWorkItem({ organizationId: input.organizationId, kind: "claude.lauf", idempotencyKey: `claude.lauf:${id}`, payload: { auftragId: id }, maxAttempts: 1 });
  return auftrag;
}

function anweisung(auftrag: Auftrag, p: ClaudeProjekt): string {
  return [
    `Du arbeitest im Auftrag von NOVA für Joachim am Projekt „${p.beschreibung}“.`,
    "",
    "## Aufgabe",
    auftrag.aufgabe,
    "",
    "## Woran Joachim erkennt, dass es fertig ist",
    auftrag.abnahmekriterium || "(nicht genannt – setze die Aufgabe sauber und vollständig um)",
    "",
    "## Regeln",
    `- Du bist auf dem Branch ${auftrag.branch}. Bleib darauf. Nicht mergen, nicht auf ${p.hauptzweig} pushen, nichts veröffentlichen oder deployen – das macht NOVA nach Joachims Freigabe.`,
    `- Prüfe deine Änderung mit: ${p.pruefen.join(" und ")}.`,
    `- Committe am Ende mit einer kurzen deutschen Nachricht und pushe den Branch: git push -u origin ${auftrag.branch}`,
    "- Keine Secrets, keine .env-Dateien anfassen. Nichts löschen, was nicht zur Aufgabe gehört.",
    "- Antworte am Ende in ein, zwei einfachen deutschen Sätzen, die man vorlesen kann: was sich für Joachim sichtbar geändert hat. Keine Dateinamen, keine Befehle, keine Branch-Namen, keine Code-Formatierung. Wenn etwas unklar war, stell stattdessen die Frage.",
  ].join("\n");
}

/** Worker-Teil „claude.lauf“. */
export async function fuehreAuftragAus(input: { auftragId: string; claude: ClaudeRunner }): Promise<Auftrag> {
  let auftrag = leseAuftrag(input.auftragId);
  const p = projekt(auftrag.projekt);
  auftrag = speichere({ ...auftrag, status: "laeuft" });
  try {
    await bereitFuerAuftrag(p);
    await git(p.ordner, `checkout -b ${auftrag.branch}`);
    const ergebnis = await input.claude({ ordner: p.ordner, auftrag: anweisung(auftrag, p), hauptzweig: p.hauptzweig });
    const offen = (await git(p.ordner, "status --porcelain")).trim();
    if (offen) {
      await git(p.ordner, "add -A");
      await git(p.ordner, `commit -m "NOVA-Auftrag ${auftrag.id}: offene Änderungen von Claude übernommen"`);
    }
    const commits = (await git(p.ordner, `log --format=%s ${p.hauptzweig}..HEAD`)).split("\n").filter(Boolean);
    const dateien = (await git(p.ordner, `diff --name-only ${p.hauptzweig}...HEAD`)).split("\n").filter(Boolean);
    const pruefung: NonNullable<Auftrag["pruefung"]> = [];
    for (const befehl of p.pruefen) {
      const result = await fuehreBefehlAus(befehl, p.ordner);
      pruefung.push({ befehl, ok: result.ok, ausgabe: result.ausgabe.split("\n").slice(-15).join("\n") });
    }
    await git(p.ordner, `checkout ${p.hauptzweig}`);
    const ok = ergebnis.ok && commits.length > 0 && pruefung.every((item) => item.ok);
    auftrag = speichere({
      ...auftrag,
      status: ok ? "fertig" : "fehlgeschlagen",
      zusammenfassung: ergebnis.text.trim(),
      kostenUsd: ergebnis.kostenUsd,
      commits,
      dateien,
      pruefung,
      fehler: ok
        ? undefined
        : !ergebnis.ok
          ? "Claude Code hat den Auftrag nicht sauber abgeschlossen."
          : commits.length === 0
            ? "Es gibt keine Änderung."
            : `Prüfung fehlgeschlagen: ${pruefung.filter((item) => !item.ok).map((item) => item.befehl).join(", ")}`,
    });
  } catch (error) {
    await fuehreBefehlAus(`git checkout ${p.hauptzweig}`, p.ordner).catch(() => undefined);
    auftrag = speichere({ ...auftrag, status: "fehlgeschlagen", fehler: error instanceof Error ? error.message : String(error) });
  }
  await meldeErgebnis(auftrag);
  return auftrag;
}

/** Macht Claudes Zusammenfassung vorlesbar: ohne Code-Formatierung, Pfade und Branch-Namen. */
function sprechbar(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\bnova\/[\w-]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function meldeErgebnis(auftrag: Auftrag) {
  const p = projekt(auftrag.projekt);
  const pruefText = (auftrag.pruefung ?? []).map((item) => `${item.befehl} ${item.ok ? "ok" : "fehlgeschlagen"}`).join(", ");
  if (auftrag.status === "fertig") {
    const alleOk = (auftrag.pruefung ?? []).every((item) => item.ok);
    await meldeNutzer({
      organizationId: auftrag.organizationId,
      anlass: `claude-fertig:${auftrag.id}`,
      text:
        `Claude ist fertig mit deinem Auftrag für die ${p.beschreibung}: ${sprechbar(auftrag.zusammenfassung ?? "")} ` +
        `${alleOk ? "Ich habe es geprüft, alles in Ordnung." : "Bei meiner Prüfung gab es Auffälligkeiten."} Soll ich es live stellen?`,
      werkzeugNotiz: `claude_status: ${JSON.stringify({ ok: true, executed: false, data: { auftrag_id: auftrag.id, status: auftrag.status, pruefung: pruefText } })}`,
    });
    return;
  }
  await meldeNutzer({
    organizationId: auftrag.organizationId,
    anlass: `claude-fehler:${auftrag.id}`,
    text: `Der Auftrag für die ${p.beschreibung} ist nicht fertig geworden: ${auftrag.fehler ?? "unbekannter Grund"}.${auftrag.zusammenfassung ? ` Claude schreibt: ${sprechbar(auftrag.zusammenfassung)}` : ""} Live gestellt wurde nichts.`,
    werkzeugNotiz: `claude_status: ${JSON.stringify({ ok: true, executed: false, data: { auftrag_id: auftrag.id, status: auftrag.status } })}`,
  });
}

/** Live stellen: nur mit Joachims Freigabe für genau diesen Auftrag. */
export async function claudeLiveStellen(input: { organizationId: string; auftragId: string; freigabeId?: string }) {
  assertOrganizationId(input.organizationId);
  const auftrag = leseAuftrag(input.auftragId);
  if (auftrag.status !== "fertig") throw new Error(`Der Auftrag ist ${auftrag.status.replace(/_/g, " ")} – live geht nur ein fertiger, geprüfter Auftrag.`);
  const p = projekt(auftrag.projekt);
  if (!input.freigabeId) {
    const approval = await createApprovalRequest({
      organizationId: input.organizationId,
      actionType: "claude.live",
      description: `${p.beschreibung}: Auftrag ${auftrag.id} übernehmen, pushen und veröffentlichen`,
      payload: { auftragId: auftrag.id },
    });
    return { status: "freigabe_noetig" as const, freigabe_id: approval.id, projekt: p.beschreibung, dateien: auftrag.dateien ?? [] };
  }
  const pending = await prisma.approvalRequest.findFirst({
    where: { id: input.freigabeId, organizationId: input.organizationId, actionType: "claude.live", status: "pending" },
  });
  const payload = pending ? (JSON.parse(pending.payload || "{}") as { auftragId?: string }) : {};
  if (!pending || payload.auftragId !== auftrag.id) throw new Error("Diese Freigabe gehört nicht zu diesem Auftrag.");
  await decideApproval({ organizationId: input.organizationId, approvalId: pending.id, status: "approved" });
  speichere({ ...auftrag, status: "wird_live" });
  await enqueueWorkItem({ organizationId: input.organizationId, kind: "claude.live", idempotencyKey: `claude.live:${auftrag.id}`, payload: { auftragId: auftrag.id }, maxAttempts: 1 });
  return { status: "wird_live" as const, projekt: p.beschreibung };
}

/** Worker-Teil „claude.live“: übernehmen, pushen, veröffentlichen, melden. */
export async function fuehreLiveAus(input: { auftragId: string }): Promise<Auftrag> {
  let auftrag = leseAuftrag(input.auftragId);
  const p = projekt(auftrag.projekt);
  let schritt: "vorbereitung" | "uebernommen" | "gepusht" = "vorbereitung";
  try {
    await bereitFuerAuftrag(p);
    await git(p.ordner, `pull --ff-only origin ${p.hauptzweig}`);
    await git(p.ordner, `merge --no-ff ${auftrag.branch} -m "NOVA-Auftrag ${auftrag.id} übernommen"`);
    schritt = "uebernommen";
    await git(p.ordner, `push origin ${p.hauptzweig}`);
    schritt = "gepusht";
    const live = await fuehreBefehlAus(p.live, p.ordner, 30 * 60_000);
    auftrag = speichere({
      ...auftrag,
      status: live.ok ? "live" : "live_fehlgeschlagen",
      live: { ok: live.ok, ausgabe: live.ausgabe.split("\n").slice(-20).join("\n"), zeit: new Date().toISOString() },
      fehler: live.ok ? undefined : "Das Live-Skript ist fehlgeschlagen.",
    });
  } catch (error) {
    auftrag = speichere({ ...auftrag, status: "live_fehlgeschlagen", fehler: error instanceof Error ? error.message : String(error) });
  }
  const ende = auftrag.live?.ausgabe.split("\n").filter(Boolean).at(-1) ?? auftrag.fehler ?? "";
  const stand =
    schritt === "vorbereitung"
      ? "Nichts wurde übernommen oder veröffentlicht."
      : schritt === "uebernommen"
        ? `Die Änderung ist lokal in ${p.hauptzweig} übernommen, aber nicht gepusht und nicht veröffentlicht.`
        : `Die Änderung ist in ${p.hauptzweig} übernommen und gepusht, aber das Veröffentlichen ist fehlgeschlagen – bitte die Seite prüfen.`;
  await meldeNutzer({
    organizationId: auftrag.organizationId,
    anlass: `claude-live:${auftrag.id}`,
    text:
      auftrag.status === "live"
        ? `Die Änderung an der ${p.beschreibung} ist live. Letzte Meldung vom Veröffentlichen: ${ende}`
        : `Live stellen hat nicht geklappt: ${ende}. ${stand}`,
  });
  return auftrag;
}
