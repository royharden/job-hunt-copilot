import fs from "node:fs";
import path from "node:path";
import { chromium } from "../../.agent-work/rv-tooling/node_modules/playwright-core/index.mjs";
const base = "http://127.0.0.1:23121";
const cache = "C:/Users/Roy Harden/AppData/Local/ms-playwright/chromium_headless_shell-1243";
function findShell(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isFile() && entry.name === "chrome-headless-shell.exe") return file;
    if (entry.isDirectory()) { const found = findShell(file); if (found) return found; }
  }
}
const executablePath = findShell(cache);
if (!executablePath) throw new Error("Installed test-only headless shell not found");
const browser = await chromium.launch({ executablePath, headless: true, timeout: 20000,
  args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const external = []; const errors = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === base) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle", timeout: 30000 });
  const text = await page.locator("body").innerText();
  fs.writeFileSync(".agent-work/rv-browser-probe.txt", text);
  console.log(JSON.stringify({ executablePath, title: await page.title(), text, external, errors }, null, 2));
} finally { await browser.close(); }
