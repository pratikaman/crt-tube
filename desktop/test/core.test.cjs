const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HOME, DEFAULTS, destination, isAllowedNavigation, isYouTubeURL, sanitizeSettings } = require('../core.cjs');
const { createMaskSilhouette } = require('../silhouette.cjs');

test('tuning accepts YouTube links, short links, and ordinary searches', () => {
  assert.equal(destination(''), HOME);
  assert.equal(destination('  cats & dogs  '), `${HOME}results?search_query=cats%20%26%20dogs`);
  assert.equal(destination('youtu.be/abc?t=20'), 'https://youtu.be/abc?t=20');
  assert.equal(destination('http://www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(destination('https://www.youtube.com/playlist?list=abc'), 'https://www.youtube.com/playlist?list=abc');
  assert.equal(destination('https://example.com'), `${HOME}results?search_query=https%3A%2F%2Fexample.com`);
});

test('remote navigation only allows YouTube and its explicit account / consent origins', () => {
  for (const url of ['https://www.youtube.com/watch?v=x', 'https://m.youtube.com/', 'https://youtu.be/x']) assert.ok(isYouTubeURL(url));
  for (const url of ['https://accounts.google.com/signin', 'https://consent.google.com/']) assert.ok(isAllowedNavigation(url));
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'http://youtube.com', 'https://youtube.com.evil.com', 'https://youtube.com@evil.com', 'https://user:pass@youtube.com', 'https://evilaccounts.google.com', 'not a url']) {
    assert.equal(isAllowedNavigation(url), false, url);
  }
});

test('settings tolerate corrupt files and reject unknown or untrusted values', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULTS);
  assert.deepEqual(sanitizeSettings([]), DEFAULTS);
  assert.deepEqual(sanitizeSettings({ volume: '100', intensity: NaN, crt: 1, arbitrary: true }), DEFAULTS);
  const updated = sanitizeSettings({ volume: 120, intensity: -5, roll: true });
  assert.equal(updated.volume, 100);
  assert.equal(updated.intensity, 0);
  assert.equal(updated.roll, true);
  assert.deepEqual(sanitizeSettings({ muted: true }, updated), { ...updated, muted: true });
});

test('3D masks follow the rotated outline and reject invalid IPC payloads', () => {
  const pixels = new Uint8Array([0, 255, 63, 64]);
  const hits = createMaskSilhouette({ width: 2, height: 2, pixels });
  const bounds = { x: 40, y: 20, width: 200, height: 100 };
  assert.equal(hits({ x: 50, y: 30 }, bounds), false);
  assert.equal(hits({ x: 200, y: 30 }, bounds), true);
  assert.equal(hits({ x: 50, y: 90 }, bounds), false);
  assert.equal(hits({ x: 200, y: 90 }, bounds), true);
  assert.equal(hits({ x: 240, y: 50 }, bounds), false);
  assert.equal(hits({ x: 200, y: 120 }, bounds), false);
  pixels.fill(0);
  assert.equal(hits({ x: 200, y: 30 }, bounds), true, 'mask owns its buffer');
  assert.equal(hits({ x: 100, y: 25 }, { x: 0, y: 0, width: 120, height: 60 }), true);
  for (const mask of [null, {}, { width: 257, height: 1, pixels: new Uint8Array(257) },
    { width: 2, height: 2, pixels: [0, 255, 255, 0] }, { width: 2, height: 2, pixels: new Uint8Array(3) }]) {
    assert.equal(createMaskSilhouette(mask), null);
  }
});
