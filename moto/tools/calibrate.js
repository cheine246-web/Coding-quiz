// Misst mit dem eingebauten Bot (Skill 1.0: Absprung-Timing, Tricks, Flips) die erreichbare
// Punktzahl jeder Strecke. Den Mittelwert tragen wir als `ref` in TRACKS (moto/game.js) ein –
// daraus ergeben sich die Medaillen.
//
//   node moto/tools/calibrate.js [Läufe pro Strecke]      (benötigt Playwright + Chromium)
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const RUNS = Number(process.argv[2]) || 5;
(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(500);
  const res = await page.evaluate((runs) => {
    const F = window.FMX;
    const out = [];
    for (const def of F.TRACKS) {
      const scores = [];
      for (let r = 0; r < runs; r++) {
        F.game.autopilot = 1;
        F.startGame(def.id);
        for (let n = 0; F.game.state === 'play' && n < 120 * 600; n++) F.step(1 / 120);
        scores.push(Math.round(F.player.score));
      }
      out.push({ id: def.id, ref: def.ref, scores });
    }
    F.game.autopilot = 0;
    return out;
  }, RUNS);
  for (const r of res) {
    const avg = Math.round(r.scores.reduce((a, b) => a + b, 0) / r.scores.length / 500) * 500;
    console.log(`${r.id.padEnd(8)} Mittel ${String(avg).padStart(7)}   (Läufe: ${r.scores.join(', ')})   aktuelles ref: ${r.ref}`);
  }
  await browser.close();
})();
