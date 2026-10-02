'use strict';

// Sample the rendered object's alpha, so empty desktop space stays clickable.
// The crop matches the CSS scene; shadows below 25% opacity aren't interactive.
function createSilhouette(image) {
  const crop = image.resize({ width: 1920, height: 1080 }).crop({ x: 550, y: 255, width: 820, height: 690 });
  const pixels = crop.toBitmap();
  return (point, bounds) => {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
    const x = Math.floor((point.x - bounds.x) * 820 / bounds.width);
    const y = Math.floor((point.y - bounds.y) * 690 / bounds.height);
    return x >= 0 && x < 820 && y >= 0 && y < 690 && pixels[(y * 820 + x) * 4 + 3] >= 64;
  };
}

function createMaskSilhouette(mask) {
  if (!mask || !Number.isInteger(mask.width) || !Number.isInteger(mask.height) ||
      mask.width < 1 || mask.height < 1 || mask.width > 256 || mask.height > 256 ||
      !(mask.pixels instanceof Uint8Array) || mask.pixels.length !== mask.width * mask.height) return null;
  const { width, height } = mask;
  const pixels = Uint8Array.from(mask.pixels);
  return (point, bounds) => {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
    const x = Math.floor((point.x - bounds.x) * width / bounds.width);
    const y = Math.floor((point.y - bounds.y) * height / bounds.height);
    return x >= 0 && x < width && y >= 0 && y < height && pixels[y * width + x] >= 64;
  };
}

module.exports = { createSilhouette, createMaskSilhouette };
