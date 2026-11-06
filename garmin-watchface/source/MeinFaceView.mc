using Toybox.Activity;
using Toybox.ActivityMonitor;
using Toybox.Graphics;
using Toybox.Math;
using Toybox.System;
using Toybox.Time;
using Toybox.Time.Gregorian;
using Toybox.UserProfile;
using Toybox.Weather;
using Toybox.WatchUi;

// Watchface-Layout (alles relativ zum Radius R, funktioniert auf fr265 und fr265s):
//
//        ╭ Schritt-Ziel-Bogen (10 Segmente) ╮
//                    FR 6
//        ───────────────────────────
//      🏃 8133   |   7° ☁
//        ───────────────────────────
//      ᛒ   1914  [2]
//                  21
//        ───────────────────────────
//      ♡ 48    |    43 ♥
//        ───────────────────────────
//                   99%
//        ╰──── Akku-Bogen ─────────╯
class MeinFaceView extends WatchUi.WatchFace {

    var mSleeping = false;
    var mTimeFont = null;

    // Farben
    var cText = 0xE8EAFF;   // leicht bläuliches Weiß
    var cDim  = 0x3C3C50;   // gedimmte Segmente / Hintergrund-Bögen
    var cRed  = 0xFF4A3D;   // Benachrichtigungs-Badge / Akku niedrig
    var cGrey = 0x8A8CA8;   // Always-on-Modus

    // aktuelle Geometrie
    var mCx = 0;
    var mCy = 0;
    var mR  = 100.0;

    var mDays = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];

    function initialize() {
        WatchFace.initialize();
    }

    function onEnterSleep() {
        mSleeping = true;
        WatchUi.requestUpdate();
    }

    function onExitSleep() {
        mSleeping = false;
        WatchUi.requestUpdate();
    }

    // ------------------------------------------------------------------
    //  Hauptzeichenroutine
    // ------------------------------------------------------------------
    function onUpdate(dc) {
        mCx = dc.getWidth() / 2;
        mCy = dc.getHeight() / 2;
        mR  = dc.getWidth() / 2.0;

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        if (dc has :setAntiAlias) {
            dc.setAntiAlias(true);
        }

        if (mSleeping) {
            drawSleep(dc);
            return;
        }

        drawStepArc(dc);
        drawDate(dc);
        drawStepsAndWeather(dc);
        drawTime(dc);
        drawHeartRates(dc);
        drawBattery(dc);

        // Trennlinien
        dc.setColor(cText, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);
        hLine(dc, -0.54);
        hLine(dc, -0.26);
        hLine(dc, 0.19);
        hLine(dc, 0.49);
        vLine(dc, 0.0, -0.37, 0.10);
        vLine(dc, 0.0, 0.40, 0.10);
    }

    // ------------------------------------------------------------------
    //  Hilfsfunktionen
    // ------------------------------------------------------------------
    function fx(f) {          // x relativ zur Mitte
        return (mCx + f * mR).toNumber();
    }

    function fy(f) {          // y relativ zur Mitte
        return (mCy + f * mR).toNumber();
    }

    function hLine(dc, dy) {
        var rr = 0.80;
        var half = Math.sqrt(rr * rr - dy * dy);
        dc.drawLine(fx(-half), fy(dy), fx(half), fy(dy));
    }

    function vLine(dc, dx, dyCenter, halfHeight) {
        dc.drawLine(fx(dx), fy(dyCenter - halfHeight), fx(dx), fy(dyCenter + halfHeight));
    }

    function text(dc, str, dx, dy, font, just) {
        dc.drawText(fx(dx), fy(dy), font, str, just | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // ------------------------------------------------------------------
    //  Oben: Schritt-Ziel als 10 Segmente
    // ------------------------------------------------------------------
    function drawStepArc(dc) {
        var info = ActivityMonitor.getInfo();
        var progress = 0.0;
        if (info.steps != null && info.stepGoal != null && info.stepGoal > 0) {
            progress = info.steps.toFloat() / info.stepGoal.toFloat();
        }
        if (progress > 1.0) { progress = 1.0; }
        var lit = Math.floor(progress * 10.0 + 0.5).toNumber();

        var r = (0.88 * mR).toNumber();
        dc.setPenWidth(7);
        for (var i = 0; i < 10; i++) {
            var start = 120.0 - i * 6.0;
            dc.setColor(i < lit ? cText : cDim, Graphics.COLOR_TRANSPARENT);
            dc.drawArc(mCx, mCy, r, Graphics.ARC_CLOCKWISE, start, start - 4.5);
        }
    }

    // ------------------------------------------------------------------
    //  Datum
    // ------------------------------------------------------------------
    function drawDate(dc) {
        var now = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        var str = mDays[now.day_of_week - 1] + " " + now.day.format("%d");
        dc.setColor(cText, Graphics.COLOR_TRANSPARENT);
        text(dc, str, 0.0, -0.62, Graphics.FONT_MEDIUM, Graphics.TEXT_JUSTIFY_CENTER);
    }

    // ------------------------------------------------------------------
    //  Schritte | Temperatur + Wetter
    // ------------------------------------------------------------------
    function drawStepsAndWeather(dc) {
        var y = -0.37;
        var info = ActivityMonitor.getInfo();

        dc.setColor(cText, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(3);
        drawRunner(dc, fx(-0.66), fy(y), 0.085 * mR);

        var steps = (info.steps != null) ? info.steps.toString() : "--";
        text(dc, steps, -0.55, y, Graphics.FONT_MEDIUM, Graphics.TEXT_JUSTIFY_LEFT);

        // Wetter
        var tempStr = "--";
        var cond = 2;
        if (Toybox has :Weather) {
            var w = Weather.getCurrentConditions();
            if (w != null) {
                if (w.temperature != null) {
                    var t = w.temperature.toFloat();
                    if (System.getDeviceSettings().temperatureUnits == System.UNIT_STATUTE) {
                        t = t * 9.0 / 5.0 + 32.0;
                    }
                    tempStr = Math.round(t).toNumber().toString() + "°";
                }
                if (w.condition != null) {
                    cond = w.condition;
                }
            }
        }
        text(dc, tempStr, 0.26, y, Graphics.FONT_MEDIUM, Graphics.TEXT_JUSTIFY_CENTER);
        drawWeatherIcon(dc, fx(0.58), fy(y), 0.10 * mR, cond);
    }

    // ------------------------------------------------------------------
    //  Uhrzeit, Sekunden, Benachrichtigungen, Bluetooth
    // ------------------------------------------------------------------
    function drawTime(dc) {
        var clock = System.getClockTime();
        var hour = clock.hour;
        var fmt = "%02d";
        if (!System.getDeviceSettings().is24Hour) {
            hour = hour % 12;
            if (hour == 0) { hour = 12; }
            fmt = "%d";
        }
        var timeStr = hour.format(fmt) + clock.min.format("%02d");

        if (mTimeFont == null) {
            mTimeFont = pickTimeFont(dc, (0.95 * mR).toNumber());
        }

        var timeW = dc.getTextWidthInPixels(timeStr, mTimeFont);
        // rechte Kante der Uhrzeit bei +0.44 R
        var cxTime = fx(0.44) - timeW / 2;

        dc.setColor(cText, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cxTime, fy(0.0), mTimeFont, timeStr,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Sekunden
        text(dc, clock.sec.format("%02d"), 0.62, 0.07, Graphics.FONT_MEDIUM, Graphics.TEXT_JUSTIFY_CENTER);

        // Benachrichtigungs-Badge (rot, wie Sprechblase)
        var n = System.getDeviceSettings().notificationCount;
        if (n != null && n > 0) {
            var bw = (0.19 * mR).toNumber();
            var bh = (0.16 * mR).toNumber();
            var bx = fx(0.62) - bw / 2;
            var by = fy(-0.22);
            dc.setColor(cRed, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(bx, by, bw, bh, 4);
            dc.fillPolygon([[bx + bw / 2 - 4, by + bh - 1],
                            [bx + bw / 2 + 4, by + bh - 1],
                            [bx + bw / 2,     by + bh + 6]]);
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
            var label = (n > 9) ? "9+" : n.toString();
            dc.drawText(bx + bw / 2, by + bh / 2, Graphics.FONT_XTINY, label,
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // Bluetooth-Symbol
        if (System.getDeviceSettings().phoneConnected) {
            dc.setColor(cText, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
            drawBluetooth(dc, fx(-0.82), fy(0.05), 0.055 * mR);
        }
    }

    // größte Zahlenschrift wählen, die in maxW passt
    function pickTimeFont(dc, maxW) {
        var fonts = [Graphics.FONT_NUMBER_THAI_HOT,
                     Graphics.FONT_NUMBER_HOT,
                     Graphics.FONT_NUMBER_MEDIUM,
                     Graphics.FONT_NUMBER_MILD];
        for (var i = 0; i < fonts.size(); i++) {
            if (dc.getTextWidthInPixels("0000", fonts[i]) <= maxW) {
                return fonts[i];
            }
        }
        return Graphics.FONT_NUMBER_MILD;
    }

    // ------------------------------------------------------------------
    //  Herzfrequenz: Ruhepuls (Umriss) | aktueller Puls (gefüllt)
    // ------------------------------------------------------------------
    function drawHeartRates(dc) {
        var y = 0.40;

        var resting = null;
        var profile = UserProfile.getProfile();
        if (profile != null) {
            resting = profile.restingHeartRate;
        }
        var current = getCurrentHr();

        dc.setColor(cText, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(3);
        drawHeart(dc, fx(-0.62), fy(y), 0.14 * mR / 32.0, false);
        drawHeart(dc, fx(0.62), fy(y), 0.14 * mR / 32.0, true);

        text(dc, (resting != null) ? resting.toString() : "--", -0.30, y,
             Graphics.FONT_MEDIUM, Graphics.TEXT_JUSTIFY_CENTER);
        text(dc, (current != null) ? current.toString() : "--", 0.28, y,
             Graphics.FONT_MEDIUM, Graphics.TEXT_JUSTIFY_CENTER);
    }

    function getCurrentHr() {
        var hr = null;
        var act = Activity.getActivityInfo();
        if (act != null) {
            hr = act.currentHeartRate;
        }
        if (hr == null) {
            var it = ActivityMonitor.getHeartRateHistory(1, true);
            var s = (it != null) ? it.next() : null;
            if (s != null && s.heartRate != ActivityMonitor.INVALID_HR_SAMPLE) {
                hr = s.heartRate;
            }
        }
        return hr;
    }

    // ------------------------------------------------------------------
    //  Akku
    // ------------------------------------------------------------------
    function drawBattery(dc) {
        var pct = System.getSystemStats().battery;
        var col = (pct <= 20.0) ? cRed : cText;

        dc.setColor(col, Graphics.COLOR_TRANSPARENT);
        text(dc, pct.toNumber().toString() + "%", 0.0, 0.62,
             Graphics.FONT_MEDIUM, Graphics.TEXT_JUSTIFY_CENTER);

        var r = (0.84 * mR).toNumber();
        var a0 = 235.0;
        var span = 70.0;

        dc.setPenWidth(7);
        dc.setColor(cDim, Graphics.COLOR_TRANSPARENT);
        dc.drawArc(mCx, mCy, r, Graphics.ARC_COUNTER_CLOCKWISE, a0, a0 + span);

        if (pct > 0.0) {
            dc.setColor(col, Graphics.COLOR_TRANSPARENT);
            dc.drawArc(mCx, mCy, r, Graphics.ARC_COUNTER_CLOCKWISE, a0, a0 + span * pct / 100.0);
        }

        // Endpunkte
        dc.setColor(cText, Graphics.COLOR_TRANSPARENT);
        var ends = [a0, a0 + span];
        for (var i = 0; i < 2; i++) {
            var rad = Math.toRadians(ends[i]);
            dc.fillCircle(mCx + r * Math.cos(rad), mCy - r * Math.sin(rad), 4);
        }
    }

    // ------------------------------------------------------------------
    //  Always-on-Modus (AMOLED): wenig Pixel + leichte Verschiebung gegen Einbrennen
    // ------------------------------------------------------------------
    function drawSleep(dc) {
        var clock = System.getClockTime();
        var hour = clock.hour;
        var fmt = "%02d";
        if (!System.getDeviceSettings().is24Hour) {
            hour = hour % 12;
            if (hour == 0) { hour = 12; }
            fmt = "%d";
        }
        var timeStr = hour.format(fmt) + clock.min.format("%02d");

        var shift = ((clock.min % 3) - 1) * 3;

        if (mTimeFont == null) {
            mTimeFont = pickTimeFont(dc, (0.95 * mR).toNumber());
        }
        dc.setColor(cGrey, Graphics.COLOR_TRANSPARENT);
        dc.drawText(mCx + shift, mCy + shift, mTimeFont, timeStr,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var now = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        var str = mDays[now.day_of_week - 1] + " " + now.day.format("%d");
        dc.drawText(mCx + shift, fy(-0.45) + shift, Graphics.FONT_SMALL, str,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // ------------------------------------------------------------------
    //  Kleine Vektor-Icons
    // ------------------------------------------------------------------
    function drawHeart(dc, x, y, s, filled) {
        var n = 28;
        var pts = new [n];
        for (var i = 0; i < n; i++) {
            var t = (i * 2.0 * Math.PI) / n;
            var sn = Math.sin(t);
            var hx = 16.0 * sn * sn * sn;
            var hy = 13.0 * Math.cos(t) - 5.0 * Math.cos(2 * t)
                     - 2.0 * Math.cos(3 * t) - Math.cos(4 * t);
            pts[i] = [x + hx * s, y - (hy + 2.5) * s];
        }
        if (filled) {
            dc.fillPolygon(pts);
        } else {
            for (var i = 0; i < n; i++) {
                var p = pts[i];
                var q = pts[(i + 1) % n];
                dc.drawLine(p[0], p[1], q[0], q[1]);
            }
        }
    }

    function drawRunner(dc, x, y, s) {
        dc.fillCircle(x + 0.25 * s, y - 0.85 * s, 0.22 * s);
        dc.drawLine(x + 0.15 * s, y - 0.55 * s, x - 0.10 * s, y + 0.10 * s);       // Rumpf
        dc.drawLine(x + 0.10 * s, y - 0.40 * s, x + 0.65 * s, y - 0.10 * s);       // Arm vorn
        dc.drawLine(x + 0.10 * s, y - 0.40 * s, x - 0.50 * s, y - 0.25 * s);       // Arm hinten
        dc.drawLine(x - 0.10 * s, y + 0.10 * s, x + 0.40 * s, y + 0.40 * s);       // Bein vorn
        dc.drawLine(x + 0.40 * s, y + 0.40 * s, x + 0.30 * s, y + 0.95 * s);
        dc.drawLine(x - 0.10 * s, y + 0.10 * s, x - 0.50 * s, y + 0.50 * s);       // Bein hinten
        dc.drawLine(x - 0.50 * s, y + 0.50 * s, x - 0.90 * s, y + 0.35 * s);
    }

    function drawBluetooth(dc, x, y, s) {
        dc.drawLine(x, y - s, x, y + s);
        dc.drawLine(x, y - s, x + 0.6 * s, y - 0.5 * s);
        dc.drawLine(x + 0.6 * s, y - 0.5 * s, x - 0.6 * s, y + 0.5 * s);
        dc.drawLine(x, y + s, x + 0.6 * s, y + 0.5 * s);
        dc.drawLine(x + 0.6 * s, y + 0.5 * s, x - 0.6 * s, y - 0.5 * s);
    }

    function drawCloud(dc, x, y, s) {
        dc.fillCircle(x - 0.45 * s, y + 0.10 * s, 0.38 * s);
        dc.fillCircle(x,            y - 0.15 * s, 0.50 * s);
        dc.fillCircle(x + 0.50 * s, y + 0.12 * s, 0.36 * s);
        dc.fillRectangle(x - 0.45 * s, y + 0.10 * s, 0.95 * s, 0.38 * s);
    }

    function drawSun(dc, x, y, s) {
        dc.fillCircle(x, y, 0.42 * s);
        dc.setPenWidth(2);
        for (var i = 0; i < 8; i++) {
            var a = Math.toRadians(i * 45.0);
            dc.drawLine(x + 0.62 * s * Math.cos(a), y + 0.62 * s * Math.sin(a),
                        x + 0.90 * s * Math.cos(a), y + 0.90 * s * Math.sin(a));
        }
    }

    // Wetterbedingung -> Icon (Zahlen = Weather.CONDITION_*)
    function drawWeatherIcon(dc, x, y, s, cond) {
        var kind = 2;   // 0 Sonne, 1 teils bewölkt, 2 Wolke, 3 Regen, 4 Schnee, 5 Gewitter, 6 Nebel
        if (cond == 0 || cond == 23 || cond == 40) {
            kind = 0;
        } else if (cond == 1 || cond == 22 || cond == 52) {
            kind = 1;
        } else if (cond == 3 || cond == 11 || cond == 14 || cond == 15 || cond == 24 || cond == 25
                   || cond == 26 || cond == 27 || cond == 31 || cond == 45 || cond == 49) {
            kind = 3;
        } else if (cond == 4 || cond == 7 || cond == 10 || cond == 16 || cond == 17 || cond == 18
                   || cond == 19 || cond == 21 || cond == 43 || cond == 44 || cond == 46 || cond == 47
                   || cond == 48 || cond == 50 || cond == 51) {
            kind = 4;
        } else if (cond == 6 || cond == 12 || cond == 28) {
            kind = 5;
        } else if (cond == 8 || cond == 9 || cond == 29 || cond == 30 || cond == 39) {
            kind = 6;
        }

        dc.setColor(cText, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(2);

        if (kind == 0) {
            drawSun(dc, x, y, s);
        } else if (kind == 1) {
            drawSun(dc, x + 0.25 * s, y - 0.30 * s, 0.75 * s);
            dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
            drawCloud(dc, x - 0.15 * s, y + 0.15 * s, 0.85 * s);   // schwarzer Rand
            dc.setColor(cText, Graphics.COLOR_TRANSPARENT);
            drawCloud(dc, x - 0.15 * s, y + 0.15 * s, 0.75 * s);
        } else if (kind == 2) {
            drawCloud(dc, x, y, s);
        } else if (kind == 3) {
            drawCloud(dc, x, y - 0.25 * s, 0.9 * s);
            for (var i = -1; i <= 1; i++) {
                dc.drawLine(x + i * 0.45 * s, y + 0.45 * s, x + i * 0.45 * s - 0.15 * s, y + 0.85 * s);
            }
        } else if (kind == 4) {
            drawCloud(dc, x, y - 0.25 * s, 0.9 * s);
            for (var i = -1; i <= 1; i++) {
                dc.fillCircle(x + i * 0.45 * s, y + 0.65 * s, 0.10 * s);
            }
        } else if (kind == 5) {
            drawCloud(dc, x, y - 0.25 * s, 0.9 * s);
            dc.fillPolygon([[x + 0.10 * s, y + 0.30 * s], [x - 0.25 * s, y + 0.65 * s],
                            [x,            y + 0.65 * s], [x - 0.15 * s, y + 1.00 * s],
                            [x + 0.30 * s, y + 0.55 * s], [x + 0.05 * s, y + 0.55 * s]]);
        } else {
            drawCloud(dc, x, y - 0.35 * s, 0.9 * s);
            dc.drawLine(x - 0.7 * s, y + 0.45 * s, x + 0.7 * s, y + 0.45 * s);
            dc.drawLine(x - 0.5 * s, y + 0.80 * s, x + 0.5 * s, y + 0.80 * s);
        }
    }
}
