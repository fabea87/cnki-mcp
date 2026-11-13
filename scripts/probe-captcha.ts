/**
 * Dev probe: inspect the CNKI captcha page DOM so the solver can target real selectors.
 * Usage: node dist/scripts/probe-captcha.js
 */
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { config, STATE_DIR } from "../src/config.js";

const browser = await chromium.launch({ headless: process.env.HEADFUL !== "1", slowMo: 30 });
const ctx = await browser.newContext({
  userAgent: config.userAgent,
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
});
await ctx.addInitScript(`Object.defineProperty(navigator,'webdriver',{get:()=>undefined});`);
const page = await ctx.newPage();

page.on("response", (r) => {
  const u = r.url();
  if (/captcha|verify|slide|puzzle|\.png|\.jpg/i.test(u)) console.log("RESP", r.status(), u.slice(0, 160));
});

console.log("goto…");
const resp = await page.goto(`${config.base}/kns8s/search`, { waitUntil: "domcontentloaded", timeout: 60000 });
console.log("status", resp?.status(), "url", page.url());
await page.waitForTimeout(4000);
console.log("final url", page.url());

const html = await page.content();
await writeFile(`${STATE_DIR}/captcha-dom.html`, html, "utf8");

const info = await page.evaluate(() => {
  const pick = (el: Element) => ({
    tag: el.tagName.toLowerCase(),
    cls: (el as HTMLElement).className?.toString?.().slice(0, 120) ?? "",
    id: (el as HTMLElement).id ?? "",
    src: (el as HTMLImageElement).src?.slice(0, 200) ?? "",
    style: (el as HTMLElement).getAttribute?.("style")?.slice(0, 200) ?? "",
    rect: (() => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
  });
  return {
    imgs: [...document.querySelectorAll("img")].map(pick),
    canvases: [...document.querySelectorAll("canvas")].map(pick),
    divs: [...document.querySelectorAll("div[class*='captcha'],div[class*='verify'],div[class*='slide'],div[class*='puzzle']")]
      .slice(0, 30)
      .map(pick),
    iframes: [...document.querySelectorAll("iframe")].map((f) => ({ src: f.src.slice(0, 200) })),
  };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
