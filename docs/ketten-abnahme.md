# Ketten-Abnahme (Vision)

## Definition fertig

Komplette Kette in NOVA.app: Verstehen → Rückfragen → ActiveWork → Ausführen → Evidence → erst dann erledigt.

## Status jetzt

| Kette | Status |
|---|---|
| ActiveWork-Fundament | TEIL — live in NOVA.app |
| Kalender Slot-Kette | TEIL — Real-App API / Voice-API grün |
| Tickets / Projekte / Kontakte | TEIL — ActiveWork |
| Mail Absender→Entwurf→Freigabe→Send | TEIL — steuert nur `info@elevum.io` + `joachim@rankpilot.de`; Freigabe→Send Smoke grün |
| Coding Path-Slot | TEIL — Pfad-Slot Smoke grün |
| Computer Mehrschritt | TEIL — TextEdit + Screenshot Smoke |
| Wissen / Recherche / Watch | TEIL — ActiveWork + Real-App |
| Stimme Session + Voice-API | TEIL — verify + API-Stichprobe |
| Stopp bricht ActiveWork ab | TEIL — Real-App API grün |
| Stimme Live-Mic Hardware | OFFEN — manuell am Gerät |
| Vision 100% | NOCH NICHT — Rest: Live-Mic Hardware, Coding Cursor-E2E |

## Mail-Steuerung

NOVA darf nur diese Absender steuern (Entwurf + Versand):

- `info@elevum.io`
- `joachim@rankpilot.de`

Override optional: `NOVA_MAIL_STEERABLE=…`

## Stichprobe Mail (2026-09-28)

1. Entwurf von `joachim@rankpilot.de` → Freigabe  
2. Ablehnen → nichts versendet, ActiveWork zu  
3. Erneut Freigeben → `1 E-Mail(s) sind raus.` (Selbsttest)  
