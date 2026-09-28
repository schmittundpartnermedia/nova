# Phase 1 Fortschritt (2026-09-28)

Bezug: `nova-auftrag-cursor.md`, Phase 0 in `.nova/phase0-bestand.md`.

## 1.4 Freigaben — erledigt
- `services/approvals/authorize.ts` — zentrale `authorizeExternalAction`
- Verdrahtert in Computer-Agent (UI-Klicks / externe Risiken) und Mail-Draft
- Unumkehrbare Aktionen nie per Dauerfreigabe
- `docs/SECURITY.md` aktualisiert
- Unit-Tests in `lib/approvals/unit-tests.ts` (über verify:ops)

## 1.1 Wahrnehmung — Fundament
- `AIProvider.analyzeImage` + OpenAI-Umsetzung
- Anthropic/Local: klar „später“
- `lib/computer/perception.ts` (ephemeral Capture → Modell → Datei löschen)
- `verify:vision`

## 1.2 Planung — Fundament
- `agents/computer/loop.ts` (Modell-Schleife + Regex-Fallback für Tests)
- `lib/computer/allowed-apps.ts` (Freigabeliste aus Policy-conditions)

## 1.3 Primitive — Fundament
- Native CGEvent: click/move/scroll/key/type + clipboard
- Adapter `input`, Schema, Router, Risk, Capabilities

## 1.6 Hintergrund — Fundament
- Worker-Handler `mail.send`
- `services/mail/schedule.ts` mit `runAt`
- `services/jobs/resume-prompt.ts`

## 1.5 Hören — Push-to-Talk
- Kein Aktivierungswort; `VOICE_SESSION_CONFIG.pushToTalk`
- Globaler Hotkey in Launcher (UserDefaults `novaPushToTalkKey` / `NOVA_PTT_KEY`)
- Web: `nova-ptt` Events + `holdStart`/`holdEnd`

## Phase 2 Fundament
- Research speichert `publicContacts` als Contact
- Mail-Vorlagen: `MailTemplate` + `lib/mail/templates.ts` (kein fester Sponsoren-Text)
- Zeitversetzter Versand über Worker

## Bekannt offen
- Vollständige 30-Mail-Akquise-Abnahme noch nicht gelaufen
- Launcher/Helper neu bauen für CGEvent + Hotkey (`npm run macos:build`)
- Accessibility für globale Hotkeys ggf. nötig
