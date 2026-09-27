// CRT Tube: background service worker.
// Content scripts only auto-inject at page load, so YouTube tabs that were already open at install
// (or update) would ignore the switch while the popup promised "no reload needed". Inject them here.
// Also keeps the toolbar badge showing ON while the tube is warm.

async function injectOpenTabs() {
  const tabs = await chrome.tabs.query({ url: "https://*.youtube.com/*" });
  await Promise.allSettled(tabs.map(async ({ id }) => {
    await chrome.scripting.insertCSS({ target: { tabId: id }, files: ["crt.css"] });
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ["crt.js"] });
  }));
}

function paintBadge(on) {
  chrome.action.setBadgeText({ text: on ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#1f8f3c" }); // PVM power-button green
  chrome.action.setBadgeTextColor({ color: "#eaffef" });
}

const paintBadgeFromStorage = () => chrome.storage.sync.get({ on: false }, ({ on }) => paintBadge(on));

chrome.runtime.onInstalled.addListener(() => {
  injectOpenTabs();
  paintBadgeFromStorage();
});
chrome.runtime.onStartup.addListener(paintBadgeFromStorage);

// Covers every path: popup, another window, sync from another device.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && "on" in changes) paintBadge(Boolean(changes.on.newValue));
});
