// CRT mode for YouTube: one fixed overlay whose backdrop-filter bends and re-lights the page behind it.
// Warp, aperture grille and bloom follow Timothy Lottes' crt-lottes shader (libretro/glsl-shaders).
// SVG filters as backdrop-filter are Chrome-only (kube.io, "Liquid Glass in the Browser").
// The constants below are the look at intensity 50; the menu's slider scales all of it.
const WARP_X = 0.031, WARP_Y = 0.041; // Lottes defaults. Lower = flatter glass, and clicks near the edges land truer.
const CONVERGENCE = 0.06; // red warps a little more, blue a little less: colour fringing toward the edges
const GAIN = 1.25;        // makes up for the light the phosphor mask and scanlines take away
const BLOOM = 0.25;       // halation: glow from bright areas that spills over the scanlines
const NS = 'http://www.w3.org/2000/svg';

// Intensity slider (0–100) → effect level: 0.2 (faint) at 0, 1 (the look above) at 50, 2 (heavy) at 100.
const levelOf = v => v <= 50 ? 0.2 + 0.016 * v : v / 50;
let level = 1;

// One 3×3 px phosphor cell: R|G|B aperture-grille stripes (dark ≈ 0.8) under a scanline that dominates, as on a TV.
const CELL = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6" viewBox="0 0 3 3">' +
  '<path d="M0 0h1v3H0z" fill="#fcc"/><path d="M1 0h1v3H1z" fill="#cfc"/><path d="M2 0h1v3H2z" fill="#ccf"/>' +
  '<linearGradient id="s" x2="0" y2="1"><stop stop-opacity=".7"/><stop offset=".35" stop-opacity="0"/>' +
  '<stop offset=".65" stop-opacity="0"/><stop offset="1" stop-opacity=".7"/></linearGradient>' +
  '<rect width="3" height="3" fill="url(#s)"/></svg>');

const svg = (tag, attrs, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  n.append(...kids);
  return n;
};
const only = ch => ['1 0 0 0 0', '0 1 0 0 0', '0 0 1 0 0'].map((row, i) => i === ch ? row : '0 0 0 0 0').join(' ') + ' 0 0 0 1 0';
const add = (a, b, result) => svg('feComposite', { in: a, in2: b, operator: 'arithmetic', k2: 1, k3: 1, result });

const map = svg('feImage', { x: 0, y: 0, preserveAspectRatio: 'none', result: 'map' });
const guns = [0, 1, 2].map(() => svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', xChannelSelector: 'R', yChannelSelector: 'G' }));
const lit = svg('feComposite', { in: 'tube', in2: 'cells', operator: 'arithmetic', result: 'lit' }); // k1, k2 set by fit()
const bloom = svg('feComposite', { in: 'lit', in2: 'glow', operator: 'arithmetic', k2: 1 });         // k3 set by fit()
const filter = svg('filter', { id: 'crt-filter', 'color-interpolation-filters': 'sRGB' },
  map,
  ...guns.flatMap((gun, ch) => [gun, svg('feColorMatrix', { values: only(ch), result: 'c' + ch })]),
  add('c0', 'c1', 'rg'),
  add('rg', 'c2', 'rgb'),
  // Past the page edge Chrome feeds the filter mirrored pixels; the map's B channel blacks them out.
  svg('feColorMatrix', { in: 'map', values: '0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 1 0', result: 'glass' }),
  svg('feComposite', { in: 'rgb', in2: 'glass', operator: 'arithmetic', k1: 1, result: 'tube' }),
  svg('feImage', { href: CELL, x: 0, y: 0, width: 3, height: 3 }),
  svg('feTile', { result: 'cells' }),
  lit,
  svg('feGaussianBlur', { in: 'tube', stdDeviation: 3, result: 'glow' }),
  bloom);

const crt = document.createElement('div');
crt.id = 'crt-screen';
crt.style.backdropFilter = 'url(#crt-filter)';
crt.append(svg('svg', { width: 0, height: 0 }, filter));
crt.addEventListener('animationend', e => e.animationName === 'crt-off' && crt.remove());

// Displacement map for the current viewport. Lottes' Warp(): screen point p shows the page at
// p * (1 + p.yx² * warp). R/G store that offset in x/y (128 = none; s is the feDisplacementMap scale),
// B is 255 while that point is still on the page, fading to 0 across one map pixel at the tube's edge.
function warpMap(w, h, wx, wy, s) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w / 4); c.height = Math.ceil(h / 4); // smooth field, quarter resolution is plenty
  const img = new ImageData(c.width, c.height), d = img.data;
  for (let j = 0, o = 0; j < c.height; j++) for (let i = 0; i < c.width; i++, o += 4) {
    const x = (i + 0.5) / c.width * 2 - 1, y = (j + 0.5) / c.height * 2 - 1;
    const sx = x * (1 + y * y * wx), sy = y * (1 + x * x * wy);
    d[o] = 127.5 + 127.5 * (sx - x) * w / s;
    d[o + 1] = 127.5 + 127.5 * (sy - y) * h / s;
    d[o + 2] = 255 * (0.5 + Math.min((1 - Math.abs(sx)) * c.width, (1 - Math.abs(sy)) * c.height) / 2);
    d[o + 3] = 255;
  }
  c.getContext('2d').putImageData(img, 0, 0);
  return c.toDataURL();
}

function fit() {
  const w = crt.clientWidth, h = crt.clientHeight, wx = WARP_X * level, wy = WARP_Y * level;
  if (!w || !h) return; // A native view can mount before its first layout.
  const s = Math.max(wx * w, wy * h);
  map.setAttribute('width', w);
  map.setAttribute('height', h);
  map.setAttribute('href', warpMap(w, h, wx, wy, s));
  guns.forEach((gun, ch) => gun.setAttribute('scale', s * (1 + CONVERGENCE * (1 - ch))));
  // Mask and scanlines fade in with the level: lit = tube × (level·GAIN·cells + 1 − level). So does the glow.
  lit.setAttribute('k1', GAIN * level);
  lit.setAttribute('k2', 1 - level);
  bloom.setAttribute('k3', BLOOM * level);
  crt.style.setProperty('--crt-i', Math.min(level, 1.5)); // glass shading and rolling lines in crt.css
}

// Fullscreen video lives in the top layer, so the overlay has to follow it in there.
const host = () => document.fullscreenElement || document.documentElement;

function power(on) {
  if (on) { host().append(crt); fit(); crt.className = 'on'; }
  else if (crt.isConnected) crt.className = 'off'; // removed when the power-off animation ends
}

addEventListener('resize', () => crt.isConnected && fit());
new ResizeObserver(() => crt.isConnected && fit()).observe(crt);
document.addEventListener('fullscreenchange', () => crt.isConnected && host().append(crt));
document.getElementById('crt-screen')?.remove(); // left behind by a copy of this script cut off by an extension reload
function applySettings(s) {
  level = levelOf(s.intensity);
  crt.toggleAttribute('data-roll', s.roll);
  if (s.on && (!crt.isConnected || crt.className === 'off')) power(true);
  else if (!s.on && crt.isConnected && crt.className !== 'off') power(false);
  else if (crt.isConnected) fit();
}

// The desktop host installs this adapter in an isolated world; the extension keeps
// using Chrome storage. Both applications render the exact same glass shader.
if (globalThis.__crtTubeDesktop) {
  globalThis.__crtTubeDesktop.update = applySettings;
  applySettings(globalThis.__crtTubeDesktop.settings);
} else {
  chrome.storage.sync.get({ on: false, intensity: 50, roll: false }, applySettings);
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'sync') return;
    if (c.intensity) { level = levelOf(c.intensity.newValue ?? 50); if (crt.isConnected) fit(); }
    if (c.roll) crt.toggleAttribute('data-roll', !!c.roll.newValue);
    if (c.on) power(!!c.on.newValue);
  });
  chrome.runtime.onMessage.addListener((msg, _, reply) => msg?.type === 'crt-ping' && reply({ pong: true }));
}
