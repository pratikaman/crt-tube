'use strict';

const DEFAULTS = Object.freeze({ crt: true, intensity: 35, roll: false, volume: 70, muted: false });
const HOME = 'https://www.youtube.com/';

function isYouTubeURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com') || url.hostname === 'youtu.be');
  } catch { return false; }
}

function isAllowedNavigation(value) {
  if (isYouTubeURL(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      ['accounts.google.com', 'consent.google.com'].includes(url.hostname);
  } catch { return false; }
}

function destination(input) {
  const value = typeof input === 'string' ? input.trim().slice(0, 2048) : '';
  if (!value) return HOME;
  const candidate = /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)(?:\/|$)/i.test(value)
    ? value.replace(/^(?:https?:\/\/)?/i, 'https://') : value;
  if (isYouTubeURL(candidate)) return candidate;
  return `${HOME}results?search_query=${encodeURIComponent(value)}`;
}

function sanitizeSettings(value = {}, base = DEFAULTS) {
  const clean = { ...base };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
  for (const key of ['crt', 'roll', 'muted']) {
    if (typeof value[key] === 'boolean') clean[key] = value[key];
  }
  for (const key of ['intensity', 'volume']) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) {
      clean[key] = Math.round(Math.max(0, Math.min(100, value[key])));
    }
  }
  return clean;
}

module.exports = { DEFAULTS, HOME, isYouTubeURL, isAllowedNavigation, destination, sanitizeSettings };
