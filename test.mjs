// Smoke test: `node test.mjs`. Loads the extension into Playwright's Chromium, flips the popup's
// switch and checks real pixels on a test page served at a youtube.com URL.
// Playwright is resolved normally, else from gstack's copy; PLAYWRIGHT can point at its index.mjs.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')
  .catch(() => import(`${process.env.HOME}/.claude/skills/gstack/node_modules/playwright/index.mjs`));

const ext = new URL('.', import.meta.url).pathname;
setTimeout(() => { console.error('timed out'); process.exit(1); }, 60000); // headless Chrome can hang on exit
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);

const page = await ctx.newPage();
const url = 'https://www.youtube.com/crt-test'; // white band along the top of a black page
await page.route(url, r => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#000"><div style="height:80px;background:#fff">' }));
await page.goto(url);

// Mean brightness of 3×3 boxes, read back from a real screenshot (backdrop-filter output is invisible to JS).
const light = async (...points) => page.evaluate(async ([png, points]) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + png;
  await img.decode();
  const g = new OffscreenCanvas(img.width, img.height).getContext('2d');
  g.drawImage(img, 0, 0);
  return points.map(([x, y]) => g.getImageData(x - 1, y - 1, 3, 3).data.reduce((s, v, i) => i % 4 === 3 ? s : s + v, 0) / 27);
}, [(await page.screenshot()).toString('base64'), points]);

const [corner] = await light([6, 6]);
assert(corner > 200, `off: page corner should be white, got ${corner}`);

await popup.click('#crt');
assert.equal(await popup.getAttribute('#switch', 'aria-checked'), 'true', 'popup: switch should read on');
await page.waitForTimeout(1500); // power-on animation
const [tube, topMiddle, bandAtCentre, bandNearEdge] = await light([6, 6], [720, 30], [720, 86], [100, 86]);
assert(tube < 30, `on: corner should be black tube glass, got ${tube}`);
assert(topMiddle > 150, `on: top middle should still show the white band, got ${topMiddle}`);
assert(bandAtCentre < 50 && bandNearEdge > 90,
  `on: barrel warp should bow the band's lower edge down toward the sides (centre ${bandAtCentre}, edge ${bandNearEdge})`);

// Full intensity bends the glass twice as hard, pushing that edge further down.
const [belowEdge] = await light([100, 96]);
await popup.fill('#intensity', '100');
await page.waitForTimeout(1000);
const [belowEdgeAtFull] = await light([100, 96]);
assert(belowEdge < 50 && belowEdgeAtFull > 90, `intensity: 100 should warp harder than 50 (${belowEdge} → ${belowEdgeAtFull})`);

await popup.click('#roll');
assert(await page.evaluate(() => document.getElementById('crt-screen').hasAttribute('data-roll')), 'rolling lines: overlay should roll');

await popup.click('#lcd');
await page.waitForTimeout(1500); // power-off animation, then the overlay removes itself
assert.equal(await page.evaluate(() => document.getElementById('crt-screen')), null, 'off: overlay should be gone');

console.log('ok');
process.exit(0);
