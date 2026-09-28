'use strict';
const $ = id => document.getElementById(id);
const api = window.tube;
let current = null;
let screenFocused = false;

function layoutScene() {
  const { width, height } = document.querySelector('.desktop-stage').getBoundingClientRect();
  const scale = screenFocused ? Math.min((width - 80) / 279, (height - 60) / 199) : Math.min(width / 820, height / 690);
  const scene = $('scene');
  scene.style.setProperty('--scene-scale', scale);
  scene.style.setProperty('--scene-x', screenFocused ? `${(410 - 339.5) * scale}px` : '0px');
  scene.style.setProperty('--scene-y', screenFocused ? `${(345 - 211.5) * scale}px` : '0px');
  if (api) reportScreen();
}

function focusSearch() { api.command('focus-search'); }
function closeControls() { return api.command('close-controls'); }
function toggleZoom() {
  screenFocused = !screenFocused;
  $('resize-grip').hidden = screenFocused || current?.fullscreen;
  $('screen-zoom').setAttribute('aria-pressed', String(screenFocused));
  $('screen-zoom').setAttribute('aria-label', screenFocused ? 'Show whole Macintosh' : 'Enlarge screen');
  layoutScene();
}

function meter(id, value) {
  // Keep the thumb under the user's pointer while asynchronous updates arrive.
  if (document.activeElement !== $(id)) $(id).value = value;
  $(id).style.setProperty('--fill', `${value}%`);
  $(`${id}-value`).textContent = String(value).padStart(2, '0');
}

function render(state) {
  if (!state) return;
  if (current?.powered && !state.powered) {
    document.body.classList.remove('powering-off');
    void document.body.offsetWidth;
    document.body.classList.add('powering-off');
  }
  const openingControls = state.controlsOpen && !current?.controlsOpen;
  current = state;
  $('resize-grip').hidden = state.fullscreen || screenFocused;
  document.body.classList.toggle('is-off', !state.powered);
  $('controls').hidden = !state.controlsOpen;
  $('standby').hidden = state.controlsOpen;
  $('back').disabled = !state.canGoBack;
  $('forward').disabled = !state.canGoForward;
  for (const id of ['power', 'physical-power']) {
    $(id).setAttribute('aria-pressed', String(state.powered));
    $(id).setAttribute('aria-label', state.powered ? 'Power off' : 'Power on');
  }
  $('crt-toggle').setAttribute('aria-pressed', String(state.crt));
  $('roll-toggle').setAttribute('aria-pressed', String(state.roll));
  $('roll-toggle').disabled = !state.crt;
  $('intensity').disabled = !state.crt;
  $('mute').setAttribute('aria-pressed', String(state.muted));
  $('mute').setAttribute('aria-label', state.muted ? 'Unmute audio' : 'Mute audio');
  $('volume-icon').setAttribute('href', state.muted ? '#i-mute' : '#i-volume');
  meter('volume', state.volume);
  meter('intensity', state.intensity);
  $('retry').hidden = !state.error || !state.powered;
  $('signal-title').textContent = !state.powered ? 'STANDBY' : state.error ? 'NO SIGNAL' : 'TUNING IN...';
  $('signal-detail').textContent = !state.powered ? 'Click the rainbow badge to power on.' : state.error || 'Warming up the picture.';
  if (openingControls) { $('search').focus(); $('search').select(); }
}

function reportScreen() {
  const { x, y, width, height } = $('screen-slot').getBoundingClientRect();
  api.setScreen({ x, y, width, height });
  const scene = $('scene').getBoundingClientRect();
  api.setScene({ x: scene.x, y: scene.y, width: scene.width, height: scene.height });
}

if (api) {
  api.subscribe(render);
  api.getState().then(render);
  new ResizeObserver(reportScreen).observe($('screen-slot'));
  window.addEventListener('resize', layoutScene);
  layoutScene();
  api.onFocusSearch(() => { $('search').focus(); $('search').select(); });
  api.onToggleZoom(toggleZoom);
  api.onEscape(() => {
    if (screenFocused) toggleZoom();
    else if (current?.fullscreen) api.command('fullscreen');
  });
  $('physical-keyboard').addEventListener('click', focusSearch);
  $('physical-disk').addEventListener('click', focusSearch);
  $('physical-mouse').addEventListener('click', async () => { await closeControls(); api.command('play'); });
  $('physical-power').addEventListener('click', () => api.command('power'));
  $('screen-zoom').addEventListener('click', () => api.command('zoom'));
  $('close-controls').addEventListener('click', closeControls);
  const grip = $('resize-grip');
  let resizePointer = null;
  function finishResize() {
    if (resizePointer === null) return;
    const pointer = resizePointer;
    resizePointer = null;
    document.body.classList.remove('is-resizing');
    if (grip.hasPointerCapture(pointer)) grip.releasePointerCapture(pointer);
    api.resize({ phase: 'end' });
  }
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizePointer = event.pointerId;
    grip.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing');
    api.resize({ phase: 'start', x: event.screenX, y: event.screenY });
  });
  grip.addEventListener('pointermove', event => {
    if (event.pointerId === resizePointer) api.resize({ phase: 'move', x: event.screenX, y: event.screenY });
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(event, finishResize);
  window.addEventListener('blur', finishResize);
  grip.addEventListener('dblclick', () => api.command('size-reset'));
  grip.addEventListener('keydown', event => {
    const command = { ArrowUp: 'size-up', ArrowRight: 'size-up', ArrowDown: 'size-down', ArrowLeft: 'size-down', Home: 'size-reset' }[event.key];
    if (command) { event.preventDefault(); api.command(command); }
  });
  $('tune-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('search').value.trim();
    if (!input) { $('search').focus(); return; }
    if (await api.tune(input)) $('search').blur();
  });
  for (const id of ['home', 'back', 'forward', 'reload', 'power', 'mute']) {
    $(id).addEventListener('click', () => api.command(id));
  }
  $('retry').addEventListener('click', () => api.command('reload'));
  $('crt-toggle').addEventListener('click', () => { if (current) api.settings({ crt: !current.crt }); });
  $('roll-toggle').addEventListener('click', () => { if (current) api.settings({ roll: !current.roll }); });
  for (const id of ['volume', 'intensity']) {
    $(id).addEventListener('input', () => {
      const value = Number($(id).value);
      meter(id, value);
      api.settings({ [id]: value, ...(id === 'volume' && value > 0 ? { muted: false } : {}) });
    });
  }
  document.addEventListener('contextmenu', event => { event.preventDefault(); api.command('context-menu'); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      finishResize();
      if (current?.controlsOpen) closeControls();
      else if (screenFocused) toggleZoom();
      else if (current?.fullscreen) api.command('fullscreen');
    }
    if (event.key === ' ' && event.target === document.body) { event.preventDefault(); api.command('play'); }
  });
} else {
  window.addEventListener('resize', layoutScene);
  layoutScene();
  $('signal-title').textContent = 'DESKTOP EDITION';
  $('signal-detail').textContent = 'Open CRT Tube for Mac to start watching.';
}
