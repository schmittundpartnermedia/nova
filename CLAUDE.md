@AGENTS.md
@docs/AUFTRAG.md
@docs/STAND.md

# Arbeitsweise in diesem Repo

- Zuerst `docs/AUFTRAG.md` (Vision, Regeln, Phasen) und `docs/STAND.md` (wo wir stehen) lesen. Es wird nur die Phase gebaut, die in STAND.md als „dran" steht. Nichts aus späteren Phasen.
- NOVA ist eine Sprach-Oberfläche mit Gedächtnis, die Aufträge an vorhandene Systeme verteilt (Apple Mail, Scraper, Cursor, Seedance), Ergebnisse prüft und berichtet. Sie klickt nicht auf dem Bildschirm. Ein Modell mit Tool-Calling entscheidet, keine Regex-Erkennung. Gesprächsverlauf und Dauergedächtnis (`~/Nova/gedaechtnis/`) gehen bei jeder Anfrage mit.
- Der Mac des Nutzers ist sein Arbeitsplatz: kein Test, Skript oder Build bedient Maus, Tastatur oder Apps ohne sein ausdrückliches Startsignal. Tests laufen mit Mock-Providern. Tests mit Apple Mail oder Mikrofon nur auf Zuruf.
- An der Wurzel bauen. Kein Fallback neben dem alten Weg, kein Regex-Sonderfall. Was ersetzt wird, wird gelöscht.
- Ehrlichkeit: `executed` nur bei realer externer Aktion. Kein Test wird ans Ist-Verhalten angepasst. Doku behauptet nur, was der Code tut. Kein „erledigt" ohne Nachweis-Ausgabe.
- Fertig heißt: läuft in NOVA.app beim Nutzer (`npm run macos:build`). Nur er nimmt ab.
- Nach jedem abgeschlossenen Schritt: Commit mit ehrlicher Beschreibung, Push, `docs/STAND.md` aktualisieren (Datum, was real läuft, was nicht, was als Nächstes dran ist).
- Sprache in Code-Kommentaren, Commits, Doku und Antworten an den Nutzer: Deutsch, kurz, ohne Behauptung ohne Nachweis.
