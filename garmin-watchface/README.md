# Mein Face – Garmin Forerunner 265 Watchface

Layout (nachgebaut nach Foto):

| Bereich | Inhalt |
|---|---|
| Oberer Bogen | Schrittziel (10 Segmente) |
| Zeile 1 | Wochentag + Tag (`FR 6`) |
| Zeile 2 | Schritte \| Temperatur + Wetter-Icon |
| Mitte | Uhrzeit groß (24 h, ohne Doppelpunkt), Sekunden klein, rotes Badge = Benachrichtigungen, Bluetooth-Symbol links |
| Zeile 3 | Ruhepuls (Herz-Umriss) \| aktueller Puls (Herz gefüllt) |
| Unten | Akku in % + Akku-Bogen |

Unterstützte Geräte: `fr265` (416×416) und `fr265s` (360×360). Alle Positionen sind relativ zum Radius.
Im Always-on-Modus (AMOLED) wird nur Uhrzeit + Datum gedimmt gezeigt (Einbrennschutz, Position wandert minimal).

## Bauen & auf die Uhr bringen (Mac)

1. VS Code installieren, Erweiterung **Monkey C** (Garmin) installieren.
2. `Cmd+Shift+P` → **Monkey C: Verify Installation** → SDK-Manager lädt das Connect IQ SDK
   (Garmin-Developer-Login nötig) und dort das Gerät **Forerunner 265** herunterladen.
3. Diesen Ordner (`garmin-watchface`) in VS Code öffnen.
4. `Cmd+Shift+P` → **Monkey C: Generate a Developer Key** (einmalig).
5. Test im Simulator: `F5` bzw. **Run Without Debugging** → Gerät `fr265` wählen.
6. `Cmd+Shift+P` → **Monkey C: Build for Device** → `fr265` → Ausgabeordner wählen → es entsteht `MeinFace.prg`.
   (Alternativ im Terminal:
   `monkeyc -d fr265 -f monkey.jungle -o bin/MeinFace.prg -y /pfad/zu/developer_key.der`)
7. Uhr per USB an den Mac anschließen. Der Forerunner 265 nutzt MTP – auf dem Mac dafür
   **OpenMTP** oder **Android File Transfer** installieren.
8. `MeinFace.prg` nach `Garmin/Apps/` auf der Uhr kopieren, Uhr auswerfen/abziehen.
9. Auf der Uhr: Zifferblatt lange gedrückt halten (oder UP gedrückt halten) → **Zifferblatt** → *Mein Face* → **Übernehmen**.
