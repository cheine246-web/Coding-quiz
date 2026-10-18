# FMX KING – Motocross Freestyle

2D-Trick-Game fürs Handy (HTML5 Canvas, keine Abhängigkeiten).
Starten: `moto/index.html` öffnen (bzw. `/moto/` auf GitHub Pages) – auf dem Handy quer halten.

- **Linker Stick**: ← → neigen (Wheelie / Back- und Frontflip), **↑ springen** – kurz vor der Rampenkante drücken (Perfect Pop)
- **Rechter Stick**: Richtung wählt den Trick (↑ Superman, → Cliffhanger, ↓ Can-Can, ← Nac-Nac) – halten, vor der Landung loslassen
- Tastatur: ← → neigen · ↑ / Leertaste springen · I L K J Tricks · P Pause
- Jedes Rennen gegen 3 Bots (halbtransparente Geister) – die meisten Punkte im Ziel gewinnen
- Jede Strecke ist fest, endet im Ziel und hat eigene Highscores + Medaillen (🥉🥈🥇)
- Highscores (Top 10 pro Strecke, Name editierbar) liegen im `localStorage`

## Neue Strecke hinzufügen

1. In `game.js` einen Eintrag in `TRACKS` ergänzen (Name, `theme` = Stadion-Look 0–2, `seed`, Anzahl Sprünge,
   Höhen `h0→h1`, Mega-Sprung `mega`, Tempo `v0→v1`, Wahrscheinlichkeit für Doubles/Whoops).
   Der `seed` sorgt dafür, dass die Strecke bei jedem Start gleich ist.
2. `node moto/tools/calibrate.js` ausführen (Playwright + Chromium nötig) und den gemessenen Mittelwert des Profi-Bots als `ref` eintragen.
   Die Stärke der Gegner-Bots je Schwierigkeit steht in `BOT_SKILL`.
   Aus `ref` werden die Medaillen berechnet (Bronze 25 %, Silber 55 %, Gold 90 %).
