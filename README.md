# CRT Tube 📺

A Chrome extension that puts YouTube on a curved, glowing CRT. The whole page (video, thumbnails,
comments) bends into the tube, picks up scanlines and an RGB phosphor mask, and blooms where it's
bright. Flip it from LCD to CRT and back from the toolbar.

![YouTube in theater mode, seen through CRT Tube](assets/screenshot.jpg)

## Install

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this folder (`crt-tube`)
4. YouTube tabs that are already open pick it up automatically; new ones do as they load.

## Use

<img src="assets/popup.png" width="296" align="right" alt="The CRT Tube menu: a mini tube showing colour bars above an LCD / CRT switch">

- Click the extension icon and flip the switch: **LCD** (off) or **CRT** (on). The mini tube in
  the menu powers up with it, and every YouTube tab follows live, no reload needed. The menu
  tells you if a tab still needs one.
- The toolbar icon shows a green **ON** badge while the tube is warm.
- The switch syncs through your Chrome profile.
- The menu is dressed as the front panel of a Sony PVM monitor: graphite bezel, recessed
  control strip, a beige button that lights up power-button green.

<br clear="right">

## What's on the glass

- **Barrel curvature** with black tube edges. The warp is Timothy Lottes' `crt-lottes` shader
  (libretro), applied to the live page through an SVG displacement map used as a
  `backdrop-filter`, the trick from kube.io's "Liquid Glass in the Browser".
- **Aperture-grille phosphor mask and scanlines**, with **bloom** that bleeds over them, after
  Lottes' mask and bloom. The scanline and RGB-stripe idea comes from Lucas Bebber's and Alec
  Lownes' CSS CRTs.
- **Convergence fringing** toward the edges, a **vignette** (Xor's GM Shaders "Mini: CRT"),
  glass glare and rounded tube corners.
- **Power on/off**: a bright line that opens into the picture, and a collapse to a dot.
- Works on the video, in fullscreen and across YouTube's page changes. With **Reduce Motion**
  on, the power animations are skipped.

Chrome only: SVG filters as `backdrop-filter` are a Chromium feature. Near the screen edges the
picture is bent a few pixels away from where clicks land; lower `WARP_X` / `WARP_Y` at the top of
`crt.js` to flatten the glass. The other knobs (convergence, gain, bloom, phosphor cell) live
there too.

## Files

- `manifest.json`: MV3 manifest
- `background.js`: toolbar badge; injects into YouTube tabs already open at install
- `crt.js`: builds the SVG filter and the overlay, follows the switch and fullscreen
- `crt.css`: glare, vignette, tube corners, power animations
- `popup.html` / `popup.js`: the LCD / CRT menu and tab status
- `assets/`: icons and screenshots. `fonts/`: Michroma and VT323 (Google Fonts, OFL)
- `test.mjs`: `node test.mjs` loads the extension in Playwright's Chromium, flips the menu's
  switch and checks the pixels

Screenshot: *Big Buck Bunny* © Blender Foundation, CC BY 3.0.
