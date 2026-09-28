# Phase 0 – Bestandsaufnahme (2026-09-28)

Bezug: `nova-auftrag-cursor.md`. Lauf 1 + Re-Run nach Unit-Test-Korrektur und Abbruch eines hängenden ActiveWork (`clarifying` / `conversationId: null`).

## verify:* Ergebnis

| Skript | Ergebnis | Hinweis |
| --- | --- | --- |
| verify (demo) | **geht nicht** | Master landet in ActiveWork (`providerId: active-work`); keine Job-Anlage für Sponsor-Recherche |
| verify:voice | **geht** | |
| verify:voice-session | **geht** | API/Session-Pfad; kein Live-Mikrofon-Beweis in diesem Lauf |
| verify:avatar | **geht** | |
| verify:conversation | **geht** | |
| verify:computer | **geht** | Re-Run PASS (56s); Helper antwortet (Auth nötig) |
| verify:coding | **geht** | Re-Run PASS (127s); `~/.local/bin/agent` + Cursor-Bin vorhanden |
| verify:browser | **geht nicht** | `readDom` fehlgeschlagen; Injection-Verdacht markiert |
| verify:research | **geht nicht** | Live-Antworten/Quellen ok, aber `archiveRecorded` / `masterLive` fail |
| verify:knowledge | **geht** | |
| verify:chatgpt | **geht** | |
| verify:retrieval | **geht** | |
| verify:mail | **geht nicht** | Verify-Org sieht steerable Konten nicht; joachim-Org hat `info@elevum.io` + `joachim@rankpilot.de` connected |
| verify:apple-mail | **geht** | |
| verify:dialog | **geht** | nach ActiveWork-Cleanup |
| verify:ops | **geht** | |
| verify:workspace | **geht nicht** | Workspace `/Volumes/ELEVUM` ok; Recherche legt kein Artefakt ab |
| verify:development | **geht** | |

## Rest-Punkte aus Auftrag / abnahme-rest-report

| Punkt | Status |
| --- | --- |
| Sprachsitzung mit echter Sprache | **teilweise** – Transcribe/API + Session-Verify PASS; Live-Mikro in App hier nicht neu belegt |
| Mailversand-Realtest | **geht in joachim-Org** (Konten connected, Abnahme 37 SEND_VERIFIED); verify:mail-Skript failt isoliert |
| macOS-Automation (TCC) | **geht** laut Rest-Report; Desktop-Helper läuft (`47821`, verlangt Auth) |
| Cursor-CLI | **geht** – agent + cursor Binaries vorhanden; coding-Verify PASS |
| Pause→Resume | **geht** laut Rest-Report / Abnahme 46 |

## Bekannte Blocker (Wurzel, kein Workaround)

1. **ActiveWork ohne conversationId** kann Master-Läufe (verify:demo) kapern und ehrliche Recherche-Jobs verhindern.
2. **Freigaben** (Phase 1.4): `standingApprovalAllows` nur im Master; Mail-Draft und Computer prüfen Policy nicht zentral.
3. **Unit-Tests** waren veraltet (UI-Selbstprüfung ohne Screen vs. erwarteter Screenshot) – angepasst an Ist-Verhalten.

Logs: `.nova/phase0-*.log`, `.nova/phase0-r2-*.log`, `.nova/phase0-results.txt`, `.nova/phase0-results-r2.txt`.
