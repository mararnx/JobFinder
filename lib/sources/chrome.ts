import path from "node:path";
import fs from "node:fs";
import type { BrowserContext, Page } from "playwright";
import { DATA_DIR } from "@/lib/db";
import type { RawJob } from "@/lib/jobs";
import { meta, setMeta } from "@/lib/queue";
import { stripHtml } from "@/lib/text";
import { careerPageLinks, frictionReason, jobPostingFromHtml, listingLinks, PORTALS, type Portal } from "./extract";

export const CHROME_PROFILE = path.join(DATA_DIR, "chrome-profile");
const SHOTS = path.join(DATA_DIR, "screenshots");

export class FrictionError extends Error {
  constructor(public portal: string, public reason: string, public screenshot: string | null) {
    super(`${portal}: ${reason}`);
  }
}

let ctxPromise: Promise<BrowserContext> | null = null;

/** One persistent browser profile for all runs; the job seeker logs in there themselves if they want. */
export async function browser(headless = true): Promise<BrowserContext> {
  if (ctxPromise) return ctxPromise;
  ctxPromise = (async () => {
    const { chromium } = await import("playwright");
    fs.mkdirSync(CHROME_PROFILE, { recursive: true });
    const opts = { headless, viewport: { width: 1280, height: 900 }, locale: "de-DE", timezoneId: "Europe/Berlin" };
    try {
      return await chromium.launchPersistentContext(CHROME_PROFILE, { ...opts, channel: "chrome" });
    } catch {
      return await chromium.launchPersistentContext(CHROME_PROFILE, opts); // bundled Chromium when Google Chrome is missing
    }
  })();
  const ctx = await ctxPromise;
  ctx.on("close", () => (ctxPromise = null));
  return ctx;
}

export async function closeBrowser() {
  const p = ctxPromise;
  ctxPromise = null;
  if (p) await (await p).close().catch(() => {});
}

const humanPause = () => new Promise((r) => setTimeout(r, 4000 + Math.random() * 8000));

function budgetKey(portal: string) {
  return `chrome:${portal}:${new Date().toISOString().slice(0, 10)}`;
}

export function pagesUsedToday(portal: string): number {
  return Number(meta(budgetKey(portal)) ?? 0);
}

export function portalBlockedToday(portal: string): string | null {
  const v = meta(`chromeBlocked:${portal}`);
  if (!v) return null;
  const { day, reason } = JSON.parse(v) as { day: string; reason: string };
  return day === new Date().toISOString().slice(0, 10) ? reason : null;
}

async function visit(page: Page, url: string, portal: string, budget: number): Promise<string> {
  const used = pagesUsedToday(portal);
  if (used >= budget) throw new Error(`daily page budget reached (${budget})`);
  setMeta(budgetKey(portal), String(used + 1));
  let reason: string | null = null;
  let html = "";
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (res && (res.status() === 403 || res.status() === 429)) reason = `Blocked by the site (HTTP ${res.status()})`;
  } catch (e) {
    // a site that drops the connection for automated browsers (StepStone does) is a block, not a bug to retry
    const m = String(e instanceof Error ? e.message : e).match(/net::(ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE|ERR_BLOCKED_BY_RESPONSE)/);
    if (!m) throw e;
    reason = `Site refused the automated browser (${m[1]})`;
  }
  if (!reason) {
    await page.waitForTimeout(1500 + Math.random() * 1500);
    html = await page.content();
    reason = frictionReason(html, page.url());
  }
  if (reason) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const shot = path.join(SHOTS, `${portal}-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    setMeta(`chromeBlocked:${portal}`, JSON.stringify({ day: new Date().toISOString().slice(0, 10), reason }));
    throw new FrictionError(portal, reason, shot);
  }
  return html;
}

export type PortalRun = { portal: Portal; keyword: string; location: string; radiusKm: number; budget: number; isKnown: (id: string) => boolean; maxDetails?: number };

/** Searches one portal for one keyword and reads new detail pages. Pure page parsing lives in ./extract. */
export async function runPortal(r: PortalRun, onPage?: (html: string, url: string) => Promise<RawJob | null>): Promise<RawJob[]> {
  const blocked = portalBlockedToday(r.portal);
  if (blocked) throw new Error(`${PORTALS[r.portal].name} paused today: ${blocked}`);
  const ctx = await browser();
  const page = await ctx.newPage();
  const out: RawJob[] = [];
  try {
    const searchUrl = PORTALS[r.portal].search(r.keyword, r.location, r.radiusKm);
    const html = await visit(page, searchUrl, r.portal, r.budget);
    const links = listingLinks(html, page.url(), r.portal).filter((l) => !r.isKnown(`${r.portal}:${l.id}`));
    for (const l of links.slice(0, r.maxDetails ?? 12)) {
      await humanPause();
      const dhtml = await visit(page, l.url, r.portal, r.budget);
      let job = jobPostingFromHtml(dhtml, l.url, r.portal);
      if (!job && onPage) job = await onPage(dhtml, l.url); // fall back to Claude reading the page text
      if (job) out.push({ ...job, source: r.portal, sourceId: `${r.portal}:${l.id}`, url: l.url });
    }
  } finally {
    await page.close().catch(() => {});
  }
  return out;
}

/** Reads one page in the browser (for manual links that need JavaScript, and careers pages without a feed). */
export async function readPage(url: string): Promise<{ html: string; text: string; finalUrl: string }> {
  const host = new URL(url).hostname;
  const ctx = await browser();
  const page = await ctx.newPage();
  try {
    const html = await visit(page, url, host, 500);
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    return { html, text: text || stripHtml(html), finalUrl: page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Careers page without a known ATS feed: find job links for the keywords and read each. */
export async function runCareersPage(url: string, company: string, keywords: string[], isKnown: (id: string) => boolean, onPage: (html: string, url: string) => Promise<RawJob | null>): Promise<RawJob[]> {
  const first = await readPage(url);
  const out: RawJob[] = [];
  for (const link of careerPageLinks(first.html, first.finalUrl, keywords).filter((l) => !isKnown(`page:${l}`)).slice(0, 10)) {
    await humanPause();
    const p = await readPage(link);
    const job = jobPostingFromHtml(p.html, link, "page") ?? (await onPage(p.html, link));
    if (job) out.push({ ...job, company: job.company || company, source: "page", sourceId: `page:${link}`, url: link });
  }
  return out;
}
