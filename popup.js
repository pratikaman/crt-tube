const sw = document.getElementById("switch");
const tube = document.getElementById("tube");
const lcd = document.getElementById("lcd");
const crt = document.getElementById("crt");
const hint = document.getElementById("hint");

let current = null;

function render(on) {
  current = on;
  sw.classList.toggle("on", on);
  tube.classList.toggle("on", on);
  sw.setAttribute("aria-checked", String(on));
  sw.setAttribute("aria-label", on ? "CRT Tube is on, press to switch to LCD" : "CRT Tube is off, press to switch to CRT");
  crt.classList.toggle("lit", on);
  lcd.classList.toggle("lit", !on);
}

// Single writer keyed off local state: no get-then-set race under rapid clicks.
function setOn(on) {
  if (current === on) return;
  render(on);
  chrome.storage.sync.set({ on });
}

sw.addEventListener("click", () => setOn(!current)); // a <button>, so Enter/Space already click
lcd.addEventListener("click", () => setOn(false));
crt.addEventListener("click", () => setOn(true));

// Stay in sync if the state changes elsewhere (another window, another device).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && "on" in changes) render(Boolean(changes.on.newValue));
});

chrome.storage.sync.get({ on: false }, ({ on }) => {
  render(on);
  document.body.offsetWidth; // flush styles so the stored state paints without animating
  document.body.classList.add("ready");
});

// Tell the truth about the active tab instead of promising "no reload needed".
async function probeActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/^https:\/\/([\w-]+\.)*youtube\.com\//.test(tab.url)) {
      hint.textContent = "Open youtube.com to warm up the tube.";
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { type: "crt-ping" });
    hint.textContent = "Live on this tab. No reload needed.";
  } catch {
    hint.textContent = "This tab predates CRT Tube. Reload it once.";
  }
}
probeActiveTab();
