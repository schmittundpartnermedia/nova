# Abnahme Rest-Report (Real-App)

Stand: 2026-09-28, Verifikation in laufender NOVA.app.

## Geschlossen in diesem Durchlauf
- Coding/Cursor: statusLine-Blockade behoben; Intent Datei-Anlegen; Real `coding-sandbox/marker-app.txt` = `app-ok`, Session COMPLETED/VERIFIED
- TextEdit öffnen: Real „TextEdit ist geöffnet.“
- Resume: INTERRUPTED + `mach weiter` → VERIFIED; Fortsetzen-UI auch ohne offene Plan-Schritte
- Mail-Freigabe-UI: Entwurf + Freigeben funktioniert; Versand ohne verbundenes Apple-Mail-Konto bewusst geblockt/fehlgeschlagen
- Fehler-Pfad: Coding mit unerlaubtem Workspace liefert Fehlerantwort; ERROR-Orb wird nicht mehr von Voice überschrieben

## Benutzerfreigabe nötig (siehe Chat)
- Automation TCC (Mail / AppleScript)
- Apple Mail in NOVA verbinden
- Mikrofon-TCC + echte Spracheingabe
- Optional Bildschirmaufnahme
