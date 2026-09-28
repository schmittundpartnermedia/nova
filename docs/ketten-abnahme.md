# Ketten-Abnahme (Vision)

## Definition fertig

Komplette Kette in NOVA.app: Verstehen → Rückfragen → ActiveWork → Ausführen → Evidence → erst dann erledigt.

## Status jetzt

| Kette | Status |
|---|---|
| ActiveWork-Fundament | TEIL — live in NOVA.app |
| Kalender Slot-Kette | TEIL — Real-App API / Voice-API grün |
| Tickets / Projekte / Kontakte | TEIL — ActiveWork |
| Mail Absender→Entwurf→Freigabe→Abschluss | TEIL — Ablehnen/Freigeben schließt ActiveWork; Sent-Verify bei Apple/iCloud noch flaky |
| Coding Path-Slot | TEIL — Pfad-Slot Smoke grün; Cursor-Lauf bewusst nicht im Smoke |
| Computer Mehrschritt | TEIL — TextEdit + Screenshot-Kette Smoke |
| Wissen Import Pfad→Einlesen | TEIL — ActiveWork + Smoke + Real-App |
| Recherche ActiveWork + Verify | TEIL — Evidence mit Connector |
| Watch-Scan | TEIL — Real-App / Voice-API grün |
| Stimme Session→ActiveWork→TTS-Text | TEIL — verify + Smoke |
| Stimme inputMode=voice Real-App | TEIL — API-Stichprobe grün |
| Stopp bricht ActiveWork ab | TEIL — Real-App API grün |
| Stimme Live-Mic Hardware | OFFEN — manuell am Gerät |
| Vision 100% | NOCH NICHT — Rest: Live-Mic Hardware, Apple Sent-Ordner-Verify hart, Coding Cursor-E2E |

## Real-App Stichproben

### Text / Kalender / Watch
1. Termin anlegen → Wann → Titel → Evidence  
2. Was steht an? → Watch Evidence  
3. Unterlagen einlesen → Pfadfrage  
4. Stopp → ActiveWork abgebrochen  

### Voice-API (`inputMode: voice`)
1. Termin-Kette über Whisper-Meta  
2. Watch-Scan  

### Mail-Freigabe
1. Entwurf → waiting_approval + ApprovalCard/„freigeben“/„ablehnen“  
2. ActiveWork wird nach Entscheidung geschlossen (Evidence)  
3. Echtes Sent-Verify in Mail.app ggf. noch verzögert/fehlschlagend  
