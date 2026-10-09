// Misst mit einem Test-Bot (Tricks + Flips) die erreichbare Punktzahl jeder Strecke.
// Die Werte tragen wir als `ref` in TRACKS (moto/game.js) ein – daraus ergeben sich die Medaillen.
//
//   node moto/tools/calibrate.js          (benötigt Playwright + Chromium)
//
// Der Bot ist bewusst "ordentlich, nicht perfekt": er fährt keine perfekten Landungen gezielt an.
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(500);
  const res = await page.evaluate(() => {
    const { bike, step, game, setAct, startGame, predictLanding, TRACKS } = window.FMX;
    const ORDER = ['cliff', 'nacnac', 'superman', 'cancan'];
    const out = [];
    for (const def of TRACKS) {
      startGame(def.id);
      let plan = null, steps = 0;
      while (game.state === 'play' && steps < 120 * 600) {
        steps++;
        if (bike.mode === 'air') {
          if (steps % 4 === 0) bike.pred = predictLanding(bike);
          if (!plan) { const total = bike.pred.t; plan = { flip: total > 2.3 ? 2 : total > 1.45 ? 1 : 0, dir: total > 1.7 ? 1 : -1 }; }
          const t = bike.airT;
          const turns = (bike.takeoffA + bike.rot - Math.atan(bike.pred.slope)) / (2 * Math.PI);
          setAct('back', !!plan.flip && plan.dir < 0 && turns > -(plan.flip - 0.22));
          setAct('fwd', !!plan.flip && plan.dir > 0 && turns < (plan.flip - 0.22));
          const slot = Math.floor((t - 0.15) / 0.5), inSlot = ((t - 0.15) % 0.5) < 0.44;
          for (const k of ORDER) setAct(k, false);
          if (t > 0.15 && bike.pred.t > 0.5 && inSlot && slot < 4) setAct(ORDER[slot], true);
        } else {
          plan = null;
          for (const k of ['back', 'fwd', ...ORDER]) setAct(k, false);
        }
        step(1 / 120);
      }
      out.push({ id: def.id, score: Math.round(game.score), lives: game.lives, flips: game.stats.flips, tricks: game.stats.tricks, ref: def.ref });
    }
    return out;
  });
  for (const r of res) console.log(`${r.id.padEnd(8)} Bot: ${String(r.score).padStart(7)}  (Herzen ${r.lives}, Tricks ${r.tricks}, Flips ${r.flips})   aktuelles ref: ${r.ref}`);
  await browser.close();
})();
