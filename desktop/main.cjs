'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, shell, session, nativeTheme, nativeImage, screen: desktopScreen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { HOME, isYouTubeURL, isAllowedNavigation, destination, sanitizeSettings } = require('./core.cjs');
const { createSilhouette } = require('./silhouette.cjs');

app.setName('CRT Tube');
// Tests use a disposable profile; this switch is ignored in distributed builds.
if (!app.isPackaged && process.env.CRT_TUBE_TEST_PROFILE) app.setPath('userData', process.env.CRT_TUBE_TEST_PROFILE);

const root = path.join(__dirname, '..');
const shellURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const settingsFile = () => path.join(app.getPath('userData'), 'picture-settings.json');
const crtSource = fs.readFileSync(path.join(root, 'crt.js'), 'utf8');
const crtStyle = fs.readFileSync(path.join(root, 'crt.css'), 'utf8');
const screenStyle = fs.readFileSync(path.join(__dirname, 'screen.css'), 'utf8');
const mediaSource = fs.readFileSync(path.join(__dirname, 'media.js'), 'utf8');
const WORLD = 1001;
let win, screen, persistTimer;
let settings = sanitizeSettings();
let powered = true, ready = false, loading = true, error = null, effectError = false;
let navigation = 0;
let navigationURL = '', loadFailed = false;
let controlsOpen = false, sceneBounds = null, pointerTimer, pointerIgnored = false;
let hitsMacintosh;
let resizeGesture = null;

function resizeMacintosh(scale, anchor = win.getBounds()) {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;
  const area = desktopScreen.getDisplayMatching(anchor).workArea;
  const maximum = Math.min(area.width / 820, area.height / 690);
  const fitted = Math.max(Math.min(0.6, maximum), Math.min(maximum, scale));
  const width = Math.round(820 * fitted), height = Math.round(690 * fitted);
  win.setBounds({
    x: Math.round(Math.max(area.x, Math.min(anchor.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(anchor.y, area.y + area.height - height))),
    width, height,
  });
}

function stopResizing() {
  resizeGesture = null;
  updatePointerPassthrough();
}

function saveSettings() {
  clearTimeout(persistTimer);
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(`${settingsFile()}.tmp`, JSON.stringify(settings, null, 2));
    fs.renameSync(`${settingsFile()}.tmp`, settingsFile());
  } catch (err) { console.error('Could not save picture settings:', err.message); }
}

function state() {
  const contents = screen?.webContents;
  const alive = contents && !contents.isDestroyed();
  return {
    ...settings, powered, ready, loading, error, effectError, controlsOpen,
    title: alive ? contents.getTitle().replace(/ - YouTube$/, '') || 'YouTube' : 'YouTube',
    url: alive ? contents.getURL() : HOME,
    canGoBack: alive ? contents.navigationHistory.canGoBack() : false,
    canGoForward: alive ? contents.navigationHistory.canGoForward() : false,
    fullscreen: !!win && !win.isDestroyed() && win.isFullScreen(),
  };
}

function publish() {
  if (win && !win.isDestroyed()) win.webContents.send('tube:state-changed', state());
}

function syncVisibility() {
  if (!screen || screen.webContents.isDestroyed()) return;
  screen.setVisible(powered && ready && !error && !controlsOpen);
  screen.webContents.setAudioMuted(!powered || settings.muted);
}

function inScreen(code, userGesture = false) {
  if (!screen || screen.webContents.isDestroyed()) return Promise.resolve();
  return screen.webContents.executeJavaScriptInIsolatedWorld(WORLD, [{ code }], userGesture);
}

async function applySettings() {
  syncVisibility();
  if (!ready || !isYouTubeURL(screen.webContents.getURL())) return;
  try {
    await inScreen(`globalThis.__crtTubeDesktop?.update(${JSON.stringify({ on: settings.crt, intensity: settings.intensity, roll: settings.roll })}); globalThis.__tubeMedia?.update(${JSON.stringify({ volume: settings.volume, powered })});`);
  } catch (err) {
    if (ready) console.error('Could not update picture:', err.message);
  }
}

async function tune(input) {
  controlsOpen = false;
  powered = true;
  error = null;
  syncVisibility();
  publish();
  try { await screen.webContents.loadURL(destination(input)); }
  catch { /* did-fail-load owns load errors; an abandoned load must not overwrite a newer page. */ }
}

function openExternal(url) {
  try {
    if (['https:', 'http:'].includes(new URL(url).protocol)) shell.openExternal(url).catch(console.error);
  } catch { /* Invalid links have no action. */ }
}

async function command(value) {
  if (!screen || screen.webContents.isDestroyed()) return state();
  const contents = screen.webContents;
  if (['home', 'back', 'forward', 'reload', 'power', 'zoom'].includes(value)) {
    controlsOpen = false;
    syncVisibility();
  }
  switch (value) {
    case 'back': if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); break;
    case 'forward': if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward(); break;
    case 'home': void tune(''); break;
    case 'reload':
      error = null; powered = true; contents.reload(); break;
    case 'power':
      powered = !powered;
      await applySettings();
      break;
    case 'fullscreen': win.setFullScreen(!win.isFullScreen()); break;
    case 'mute':
      settings.muted = !settings.muted;
      await applySettings();
      saveSettings();
      break;
    case 'play':
      if (powered && ready) await inScreen('globalThis.__tubeMedia?.togglePlayback()', true).catch(() => {});
      break;
    case 'focus-search':
      controlsOpen = true;
      syncVisibility();
      win.webContents.focus();
      publish();
      win.webContents.send('tube:focus-search');
      break;
    case 'close-controls':
      controlsOpen = false;
      syncVisibility();
      if (powered && ready && !error) contents.focus();
      break;
    case 'zoom':
      win.webContents.send('tube:toggle-zoom');
      break;
    case 'size-up': resizeMacintosh(win.getBounds().width / 820 + 0.1); break;
    case 'size-down': resizeMacintosh(win.getBounds().width / 820 - 0.1); break;
    case 'size-reset': resizeMacintosh(1); break;
    case 'context-menu':
      Menu.buildFromTemplate([
        { label: 'Search & Picture Controls…', click: () => void command('focus-search') },
        { label: 'Play / Pause', click: () => void command('play') },
        { label: 'Enlarge / Restore Screen', click: () => void command('zoom') },
        { label: 'Macintosh Size', submenu: [
          { label: 'Larger', click: () => void command('size-up') },
          { label: 'Smaller', click: () => void command('size-down') },
          { label: 'Actual Size', click: () => void command('size-reset') },
        ] },
        { label: powered ? 'Power Off' : 'Power On', click: () => void command('power') },
        { type: 'separator' }, { role: 'minimize' }, { role: 'close' },
      ]).popup({ window: win });
      break;
    default: break;
  }
  publish();
  return state();
}

function trusted(event) {
  return !!win && !win.isDestroyed() && event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === shellURL;
}

ipcMain.handle('tube:state', event => trusted(event) ? state() : null);
ipcMain.handle('tube:tune', (event, input) => {
  if (!trusted(event) || typeof input !== 'string' || input.length > 2048) return false;
  void tune(input);
  return true;
});
ipcMain.handle('tube:command', (event, input) => trusted(event) ? command(input) : null);
ipcMain.handle('tube:settings', async (event, patch) => {
  if (!trusted(event)) return null;
  settings = sanitizeSettings(patch, settings);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(saveSettings, 250);
  await applySettings();
  publish();
  return state();
});
ipcMain.on('tube:screen', (event, bounds) => {
  if (!trusted(event) || !screen || !bounds || typeof bounds !== 'object') return;
  if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))) return;
  const [width, height] = win.getContentSize();
  const x = Math.max(0, Math.min(width - 1, Math.round(bounds.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(bounds.y)));
  screen.setBounds({ x, y, width: Math.max(1, Math.min(width - x, Math.round(bounds.width))), height: Math.max(1, Math.min(height - y, Math.round(bounds.height))) });
  screen.setBorderRadius(Math.round(bounds.width * 0.045));
});
ipcMain.on('tube:scene', (event, bounds) => {
  if (!trusted(event) || !bounds || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))) return;
  if (bounds.width <= 0 || bounds.height <= 0) return;
  sceneBounds = bounds;
});
ipcMain.on('tube:resize', (event, input) => {
  if (!trusted(event) || !input || typeof input !== 'object') return;
  if (input.phase === 'end') { stopResizing(); return; }
  if (win.isFullScreen() || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return;
  if (input.phase === 'start') {
    const bounds = win.getBounds();
    resizeGesture = { bounds, x: input.x, y: input.y, dx: input.x - bounds.x, dy: input.y - bounds.y };
    pointerIgnored = false;
    win.setIgnoreMouseEvents(false);
  } else if (input.phase === 'move' && resizeGesture) {
    const { bounds, x, y, dx, dy } = resizeGesture;
    // Project the drag onto the grip's diagonal to preserve the computer's proportions.
    const change = ((input.x - x) * dx + (input.y - y) * dy) / Math.max(1, dx * dx + dy * dy);
    resizeMacintosh(bounds.width / 820 * (1 + change), bounds);
  }
});

function updatePointerPassthrough() {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || !sceneBounds || resizeGesture) return;
  const cursor = desktopScreen.getCursorScreenPoint();
  const windowBounds = win.getContentBounds();
  const ignored = !hitsMacintosh({ x: cursor.x - windowBounds.x, y: cursor.y - windowBounds.y }, sceneBounds);
  if (ignored !== pointerIgnored) {
    pointerIgnored = ignored;
    win.setIgnoreMouseEvents(ignored, { forward: true });
  }
}

function createWindow() {
  powered = true; ready = false; loading = true; error = null;
  controlsOpen = false; sceneBounds = null; pointerIgnored = false; resizeGesture = null;
  const { width, height } = desktopScreen.getPrimaryDisplay().workAreaSize;
  const scale = Math.min(1, (width - 40) / 820, (height - 30) / 690);
  win = new BrowserWindow({
    title: 'CRT Tube', width: Math.round(820 * scale), height: Math.round(690 * scale),
    // Use the grip / setBounds: native resize borders can break transparent windows.
    transparent: true, frame: false, hasShadow: false, resizable: false,
    backgroundColor: '#00000000', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  screen = new WebContentsView({
    webPreferences: {
      partition: 'persist:youtube', nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
    },
  });
  const view = screen;
  const contents = view.webContents;
  view.setBackgroundColor('#0b0d0b');
  view.setBorderRadius(24);
  view.setVisible(false);
  win.contentView.addChildView(view);
  contents.setZoomFactor(0.8);
  // A normal Chromium UA gives YouTube its desktop layout and supported video codecs.
  contents.setUserAgent(contents.getUserAgent().replace(/ Electron\/\S+/, '').replace(/ crt-tube-desktop\/\S+/i, ''));

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  contents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      win.webContents.send('tube:escape');
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) void contents.loadURL(url).catch(() => {});
    else openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) { event.preventDefault(); openExternal(url); }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  contents.on('did-start-navigation', (_event, url, inPlace, mainFrame) => {
    if (!mainFrame) return;
    if (!inPlace) { ready = false; navigation++; navigationURL = url; loadFailed = false; }
    loading = true; error = null; effectError = false;
    syncVisibility(); publish();
  });
  contents.on('did-redirect-navigation', (_event, url, _inPlace, mainFrame) => {
    if (mainFrame) navigationURL = url;
  });
  contents.on('did-finish-load', async () => {
    if (loadFailed) return; // Chromium can finish loading its own network-error document.
    const revision = navigation;
    if (isYouTubeURL(contents.getURL())) {
      try {
        await contents.insertCSS(crtStyle + '\n' + screenStyle);
        if (contents.isDestroyed() || revision !== navigation) return;
        const injectionError = await inScreen(`(() => { try {
          globalThis.__crtTubeDesktop = { settings: ${JSON.stringify({ on: settings.crt, intensity: settings.intensity, roll: settings.roll })} };
          ${crtSource}
          ${mediaSource}
          globalThis.__tubeMedia.update(${JSON.stringify({ volume: settings.volume, powered })});
        } catch (error) { return String(error.stack || error); } })()`);
        if (injectionError) throw new Error(injectionError);
      } catch (err) {
        effectError = true;
        console.error('Picture effect unavailable:', err.message);
      }
    }
    if (contents.isDestroyed() || revision !== navigation) return;
    error = null;
    ready = true;
    await applySettings();
    publish();
  });
  contents.on('did-stop-loading', () => { loading = false; publish(); });
  contents.on('did-navigate-in-page', (_event, _url, mainFrame) => { if (mainFrame) { loading = false; publish(); } });
  contents.on('page-title-updated', publish);
  contents.on('did-fail-load', (_event, code, _description, url, mainFrame) => {
    if (!mainFrame || code === -3) return;
    if (url !== navigationURL) return;
    loadFailed = true;
    loading = false; ready = false;
    error = 'YouTube could not be reached. Check your connection, then try again.';
    syncVisibility(); publish();
  });
  contents.on('render-process-gone', () => {
    ready = false; loading = false; error = 'The picture was interrupted. Retune to reconnect.';
    syncVisibility(); publish();
  });
  contents.on('enter-html-full-screen', () => win?.setFullScreen(true));
  win.on('enter-full-screen', publish);
  win.on('leave-full-screen', publish);
  win.on('blur', stopResizing);
  win.on('hide', stopResizing);
  win.on('close', saveSettings);
  win.on('closed', () => {
    clearInterval(pointerTimer);
    resizeGesture = null;
    if (!contents.isDestroyed()) contents.close();
    screen = null; win = null;
  });
  win.once('ready-to-show', () => win.show());
  hitsMacintosh ??= createSilhouette(nativeImage.createFromPath(path.join(__dirname, 'assets/macintosh-plus-render.png')));
  pointerTimer = setInterval(updatePointerPassthrough, 40);
  pointerTimer.unref();
  void win.loadFile(path.join(__dirname, 'index.html'));
  void tune('');
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [{ role: 'close' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'TV', submenu: [
      { label: 'Search YouTube…', accelerator: 'CmdOrCtrl+L', click: () => void command('focus-search') },
      { label: 'Enlarge / Restore Screen', accelerator: 'CmdOrCtrl+Shift+Z', click: () => void command('zoom') },
      { label: 'Larger Macintosh', accelerator: 'CmdOrCtrl+Plus', click: () => void command('size-up') },
      { label: 'Smaller Macintosh', accelerator: 'CmdOrCtrl+-', click: () => void command('size-down') },
      { label: 'Actual Macintosh Size', accelerator: 'CmdOrCtrl+0', click: () => void command('size-reset') },
      { label: 'Home', accelerator: 'CmdOrCtrl+Shift+H', click: () => void command('home') },
      { label: 'Back', accelerator: 'CmdOrCtrl+[', click: () => void command('back') },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => void command('forward') },
      { label: 'Retune', accelerator: 'CmdOrCtrl+R', click: () => void command('reload') },
      { type: 'separator' },
      { label: 'Play / Pause', accelerator: 'CmdOrCtrl+Return', click: () => void command('play') },
      { label: 'Mute', accelerator: 'CmdOrCtrl+Shift+M', click: () => void command('mute') },
      { label: 'Power', accelerator: 'CmdOrCtrl+Shift+P', click: () => void command('power') },
      { label: 'Full Screen', accelerator: 'Ctrl+Cmd+F', click: () => void command('fullscreen') },
    ] },
    { role: 'windowMenu' },
  ]));
}

const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } else createWindow(); });
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    app.setAboutPanelOptions({
      applicationName: 'CRT Tube',
      applicationVersion: app.getVersion(),
      credits: 'Macintosh Plus 3D model: Deutsches Museum | Digital, CC BY-SA 4.0.\nRendered with a transparent background for CRT Tube.\nhttps://sketchfab.com/3d-models/64319e3fd7dd44acb7d6d72cd8c395db\nhttps://creativecommons.org/licenses/by-sa/4.0/',
    });
    try { settings = sanitizeSettings(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch { /* First launch uses defaults. */ }
    const youtube = session.fromPartition('persist:youtube');
    youtube.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'fullscreen'));
    youtube.setPermissionCheckHandler((_contents, permission) => permission === 'fullscreen');
    youtube.on('will-download', event => event.preventDefault());
    installMenu(); createWindow();
    app.on('activate', () => { if (!win) createWindow(); else win.show(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', saveSettings);
}
