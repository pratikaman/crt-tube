// Runs in the YouTube view's isolated JavaScript world, without a Node/IPC bridge.
document.documentElement.setAttribute('dark', '');
function updatePlayerLayout() {
  document.documentElement.toggleAttribute('data-tube-watch', location.pathname === '/watch');
}
updatePlayerLayout();
document.addEventListener('yt-navigate-finish', updatePlayerLayout);
const mediaState = { volume: 70, powered: true };
const knownMedia = new WeakSet();
const pausedByPower = new Set();
function applyMedia(element, fresh = false) {
  if (fresh) {
    knownMedia.add(element);
    element.addEventListener('play', () => { if (!mediaState.powered) element.pause(); });
  }
  element.volume = mediaState.volume / 100;
  if (!mediaState.powered) {
    if (!element.paused) pausedByPower.add(element);
    element.pause();
  } else if (pausedByPower.has(element)) {
    pausedByPower.delete(element);
    element.play().catch(() => {});
  }
}
function discoverMedia() {
  document.querySelectorAll('video, audio').forEach(element => {
    if (!knownMedia.has(element)) applyMedia(element, true);
  });
  for (const element of pausedByPower) if (!element.isConnected) pausedByPower.delete(element);
}
new MutationObserver(discoverMedia).observe(document.documentElement, { childList: true, subtree: true });
discoverMedia();
globalThis.__tubeMedia = {
  update(next) {
    Object.assign(mediaState, next);
    document.querySelectorAll('video, audio').forEach(element => applyMedia(element, !knownMedia.has(element)));
  },
  togglePlayback() {
    const video = document.querySelector('video');
    if (video) { if (video.paused) video.play().catch(() => {}); else video.pause(); }
  },
};
