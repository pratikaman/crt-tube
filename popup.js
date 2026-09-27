const sw = document.getElementById("switch");
const tube = document.getElementById("tube");
const lcd = document.getElementById("lcd");
const crt = document.getElementById("crt");
const panel = document.getElementById("panel");
const intensity = document.getElementById("intensity");
const roll = document.getElementById("roll");
const hint = document.getElementById("hint");

let current = null;

function render(on) {
  current = on;
  sw.classList.toggle("on", on);
  tube.classList.toggle("on", on);
  panel.classList.toggle("off", !on);
  sw.setAttribute("aria-checked", String(on));
  sw.setAttribute("aria-label", on ? "CRT Tube is on, press to switch to LCD" : "CRT Tube is off, press to switch to CRT");
  crt.classList.toggle("lit", on);
  lcd.classList.toggle("lit", !on);
}

function showIntensity(v) {
  intensity.value = v;
  intensity.style.setProperty("--fill", v + "%");
  tube.style.setProperty("--i", v / 50); // the mini tube's scanlines and vignette follow along
}

function showRoll(on) {
  roll.setAttribute("aria-pressed", String(on));
  tube.classList.toggle("roll", on);
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

// Writes on every step so open YouTube tabs follow the drag live. storage.sync allows
// 120 writes a minute; step="5" caps one full sweep at 20.
intensity.addEventListener("input", () => {
  showIntensity(+intensity.value);
  chrome.storage.sync.set({ intensity: +intensity.value });
});

roll.addEventListener("click", () => {
  const on = roll.getAttribute("aria-pressed") !== "true";
  showRoll(on);
  chrome.storage.sync.set({ roll: on });
});

// Stay in sync if the state changes elsewhere (another window, another device).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if ("on" in changes) render(Boolean(changes.on.newValue));
  if ("intensity" in changes) showIntensity(changes.intensity.newValue ?? 50);
  if ("roll" in changes) showRoll(Boolean(changes.roll.newValue));
});

chrome.storage.sync.get({ on: false, intensity: 50, roll: false }, ({ on, intensity: v, roll: r }) => {
  render(on);
  showIntensity(v);
  showRoll(r);
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
