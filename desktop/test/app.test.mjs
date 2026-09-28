// Exercise the real Electron app with deterministic YouTube responses and playable media.
// No personal cookies or YouTube account is needed for this suite.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'crt-tube-test-'));
await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
let app;

// 10 seconds of silent PCM, playable in Chromium's video element without a codec download.
const wav = Buffer.alloc(44 + 8000 * 2 * 10);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const audio = `data:audio/wav;base64,${wav.toString('base64')}`;

const fixture = `<!doctype html><html><head><title>CRT fixture - YouTube</title></head><body style="margin:0;background:#141715;color:#dce4ca;font:20px monospace">
    <div style="height:80px;background:white;color:#111;padding-left:100px">YouTube test signal</div>
    <main style="padding:50px"><h1>CRT fixture</h1><a href="https://www.youtube.com/watch?v=test" style="color:#b1d793">Play test video</a>
    <video style="display:block;width:80%;height:160px" loop controls src="${audio}"></video></main></body></html>`;

async function intercept(offline = false) {
  await app.evaluate(({ session }, { fixture, offline }) => {
    const protocol = session.fromPartition('persist:youtube').protocol;
    try { protocol.unhandle('https'); } catch { /* No custom handler on first launch. */ }
    protocol.handle('https', () => offline ? Response.error() : new Response(fixture, { headers: { 'content-type': 'text/html' } }));
  }, { fixture, offline });
}

async function launch() {
  app = await electron.launch({ args: [root], env: { ...process.env, CRT_TUBE_TEST_PROFILE: profile }, timeout: 30000 });
  const shell = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  const screen = app.context().pages().find(page => page.url().startsWith('https://www.youtube.com')) ??
    await app.context().waitForEvent('page', { predicate: page => page.url().startsWith('https://www.youtube.com') });
  assert.ok(screen, 'native YouTube view exists');
  await intercept();
  await shell.waitForFunction(() => !!window.tube);
  await shell.evaluate(() => window.tube.command('home'));
  await screen.getByRole('link', { name: 'Play test video' }).waitFor();
  await shell.waitForFunction(async () => { const s = await window.tube.getState(); return !s.loading && !s.error && !s.effectError; });
  await screen.waitForSelector('#crt-screen', { state: 'attached' });
  return { shell, screen };
}

async function screenshot(name) {
  const base64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(root, 'test-results', name), Buffer.from(base64, 'base64'));
}

try {
  let { shell, screen } = await launch();
  const errors = [];
  shell.on('pageerror', error => errors.push(error.message));
  assert.equal(await screen.evaluate(() => typeof window.tube), 'undefined', 'YouTube has no application IPC');
  assert.equal(await screen.evaluate(() => typeof require), 'undefined', 'YouTube has no Node.js');
  const prefs = await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().startsWith('https://www.youtube.com')).getLastWebPreferences());
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);

  const windowStyle = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { shadow: w.hasShadow(), resizable: w.isResizable() };
  });
  assert.equal(windowStyle.shadow, false);
  assert.equal(windowStyle.resizable, false);
  assert.equal(await shell.locator('#controls').isVisible(), false, 'no permanent control panel');
  assert.equal(await shell.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)');
  const alpha = await app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].capturePage();
    return image.toBitmap()[3];
  });
  assert.equal(alpha, 0, 'native window corner is actually transparent');

  // Use the real renderer geometry, image alpha, timer and native mouse-event switch.
  const scene = await shell.locator('#scene').boundingBox();
  await app.evaluate(({ BrowserWindow, screen }, scene) => {
    const w = BrowserWindow.getAllWindows()[0];
    const origin = w.getContentBounds();
    globalThis.originalCursor = screen.getCursorScreenPoint;
    globalThis.originalIgnore = w.setIgnoreMouseEvents;
    globalThis.testCursor = { x: origin.x + scene.x + scene.width * 10 / 820, y: origin.y + scene.y + scene.height * 10 / 690 };
    screen.getCursorScreenPoint = () => globalThis.testCursor;
    w.setIgnoreMouseEvents = function (ignored, options) { globalThis.lastIgnored = ignored; return globalThis.originalIgnore.call(this, ignored, options); };
    globalThis.origin = origin;
  }, scene);
  await shell.waitForTimeout(100);
  // First force the pointer inside, then verify transitions in both directions.
  for (const [x, y, ignored] of [[350, 75, false], [10, 10, true], [340, 210, false], [50, 300, true], [300, 530, false]]) {
    await app.evaluate((_electron, { scene, x, y }) => {
      globalThis.testCursor = { x: globalThis.origin.x + scene.x + scene.width * x / 820, y: globalThis.origin.y + scene.y + scene.height * y / 690 };
    }, { scene, x, y });
    await shell.waitForTimeout(100);
    assert.equal(await app.evaluate(() => globalThis.lastIgnored), ignored, `click-through at scene ${x},${y}`);
  }
  await app.evaluate(({ BrowserWindow, screen }) => {
    screen.getCursorScreenPoint = globalThis.originalCursor;
    BrowserWindow.getAllWindows()[0].setIgnoreMouseEvents = globalThis.originalIgnore;
  });

  // Resize through the same captured pointer events used by the visible grip.
  await shell.evaluate(async () => { await window.tube.command('size-down'); await window.tube.command('size-down'); });
  await shell.waitForTimeout(100);
  for (const distance of [60, -85]) {
    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    const grip = await shell.locator('#resize-grip').boundingBox();
    const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
    await shell.mouse.move(x, y);
    await shell.mouse.down();
    await shell.mouse.move(x + distance, y + distance, { steps: 12 });
    await shell.mouse.up();
    await shell.waitForTimeout(150);
    const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    assert.ok(distance > 0 ? after.width > before.width + 30 : after.width < before.width - 30, 'dragging the grip changes the native window size');
    assert.ok(Math.abs(after.width / after.height - 820 / 690) < 0.004, 'resize preserves Macintosh proportions');
    assert.equal(await shell.locator('body').evaluate(body => body.classList.contains('is-resizing')), false, 'releasing the grip ends resizing');
    const slot = await shell.locator('#screen-slot').boundingBox();
    const native = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getBounds());
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(slot[key] - native[key]) <= 1, `dragged screen ${key} stays aligned`);
    assert.equal(await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toBitmap()[3]), 0, 'resizing preserves window transparency');
  }
  const smaller = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width);
  await shell.locator('#resize-grip').focus();
  await shell.keyboard.press('ArrowRight');
  await shell.waitForTimeout(100);
  assert.ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width) > smaller, 'resize grip supports the keyboard');
  await shell.evaluate(async () => { for (let i = 0; i < 20; i++) await window.tube.command('size-up'); });
  const maximum = await app.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0].getBounds();
    return { bounds, area: screen.getDisplayMatching(bounds).workArea };
  });
  assert.ok(maximum.bounds.x >= maximum.area.x && maximum.bounds.y >= maximum.area.y);
  assert.ok(maximum.bounds.x + maximum.bounds.width <= maximum.area.x + maximum.area.width);
  assert.ok(maximum.bounds.y + maximum.bounds.height <= maximum.area.y + maximum.area.height);
  await shell.evaluate(async () => { for (let i = 0; i < 30; i++) await window.tube.command('size-down'); });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width), 492, 'minimum size keeps the Macintosh usable');
  await shell.locator('#resize-grip').dblclick();
  await shell.waitForTimeout(100);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds().width), 820, 'double-click restores the original size');

  await shell.locator('#physical-keyboard').click();
  assert.equal(await shell.locator('#search').evaluate(element => element === document.activeElement), true);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible()), false, 'controls replace the native picture');
  await shell.getByRole('textbox').fill('lofi & rain');
  await shell.locator('#tune-button').click();
  await screen.waitForURL('**/results?search_query=lofi%20%26%20rain');
  await screen.waitForSelector('#crt-screen');
  await screen.getByRole('link', { name: 'Play test video' }).click();
  await screen.waitForURL('**/watch?v=test');
  await shell.waitForFunction(() => !document.getElementById('back').disabled);
  await shell.locator('#physical-keyboard').click();
  await shell.locator('#back').click();
  await screen.waitForURL('**/results?search_query=lofi%20%26%20rain');
  await shell.locator('#physical-keyboard').click();
  await shell.locator('#forward').click();
  await screen.waitForURL('**/watch?v=test');
  await screen.waitForSelector('#crt-screen');

  await shell.locator('#physical-disk').click();
  await shell.locator('#intensity').fill('80');
  await screen.waitForFunction(() => document.querySelector('#crt-screen').style.getPropertyValue('--crt-i') === '1.5');
  await shell.locator('#roll-toggle').click();
  await screen.waitForFunction(() => document.querySelector('#crt-screen').hasAttribute('data-roll'));
  await shell.locator('#crt-toggle').click();
  await screen.waitForSelector('#crt-screen', { state: 'detached' });
  await shell.locator('#crt-toggle').click();
  await screen.waitForSelector('#crt-screen');

  await shell.locator('#volume').fill('30');
  await screen.waitForFunction(() => document.querySelector('video').volume === 0.3);
  await shell.locator('#mute').click();
  assert.equal(await app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().startsWith('https://www.youtube.com')).isAudioMuted()), true);
  await shell.locator('#mute').click();
  await screen.evaluate(() => document.querySelector('video').play());
  await screen.waitForFunction(() => !document.querySelector('video').paused);
  await shell.locator('#physical-power').click();
  await screen.waitForFunction(() => document.querySelector('video').paused);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible()), false);
  await shell.waitForTimeout(600);
  await screenshot('desktop-test-standby.png');
  await shell.locator('#physical-power').click();
  await screen.waitForFunction(() => !document.querySelector('video').paused);

  for (const [width, height] of [[900, 700], [1120, 880]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    await shell.waitForTimeout(250);
    const slot = await shell.locator('#screen-slot').boundingBox();
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getBounds());
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(slot[key] - bounds[key]) <= 1, `native screen ${key} follows resized cabinet`);
    assert.equal(await shell.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false);
  }
  await screenshot('desktop-test-playing.png');

  await shell.locator('#physical-keyboard').click();
  assert.equal(await shell.locator('#search').evaluate(element => element === document.activeElement), true);
  await shell.keyboard.press('Escape');
  assert.equal(await shell.locator('#controls').isVisible(), false);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getVisible()), true, 'Escape restores the native picture');
  await shell.locator('#physical-mouse').click();
  await screen.waitForFunction(() => document.querySelector('video').paused);
  await shell.locator('#physical-mouse').click();
  await screen.waitForFunction(() => !document.querySelector('video').paused);
  const smallScreen = await shell.locator('#screen-slot').boundingBox();
  await shell.locator('#physical-keyboard').click();
  await shell.locator('#screen-zoom').click();
  const largeScreen = await shell.locator('#screen-slot').boundingBox();
  assert.ok(largeScreen.width > smallScreen.width * 2, 'screen zoom enlarges the physical glass');
  await shell.waitForTimeout(150);
  const enlargedBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0].getBounds());
  assert.ok(Math.abs(enlargedBounds.width - largeScreen.width) <= 1, 'native video follows scene zoom');
  await shell.evaluate(() => window.tube.command('zoom'));

  await intercept(true);
  await shell.locator('#physical-keyboard').click();
  await shell.locator('#reload').click();
  await shell.locator('#retry').waitFor({ state: 'visible' });
  assert.equal(await shell.locator('#signal-title').textContent(), 'NO SIGNAL');
  await intercept();
  await shell.locator('#retry').click();
  await screen.waitForSelector('#crt-screen');
  await shell.waitForFunction(async () => !(await window.tube.getState()).error);

  await app.close();
  ({ shell, screen } = await launch());
  const saved = await shell.evaluate(() => window.tube.getState());
  assert.equal(saved.intensity, 80);
  assert.equal(saved.volume, 30);
  assert.equal(saved.roll, true);
  assert.equal(saved.crt, true);
  assert.deepEqual(errors, []);
  console.log('Passed: transparent window, drag/keyboard resizing and size limits, silhouette click-through, in-screen controls, navigation, isolation, CRT effects, media power/volume, layout, zoom, offline recovery, and persistence.');
} finally {
  if (app) await app.close().catch(() => {});
  await fs.rm(profile, { recursive: true, force: true });
}
