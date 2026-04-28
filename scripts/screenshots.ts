import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const URL = process.env.SCREENSHOT_URL ?? "http://localhost:5173";
const OUT = resolve(import.meta.dir, "../assets");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("load").catch(() => {});
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/screenshot.png`, fullPage: false });
console.log("wrote", `${OUT}/screenshot.png`);

const skillRow = page
  .locator("ul li button")
  .filter({ hasText: /^\s*\/[a-z][\w-]+/i })
  .first();

if ((await skillRow.count()) > 0) {
  await skillRow.scrollIntoViewIfNeeded();
  await skillRow.click();
  await page.waitForTimeout(2400);
} else {
  console.warn("no skill row found, taking second snapshot anyway");
}

await page.screenshot({ path: `${OUT}/screenshot-skill.png`, fullPage: false });
console.log("wrote", `${OUT}/screenshot-skill.png`);

await browser.close();
