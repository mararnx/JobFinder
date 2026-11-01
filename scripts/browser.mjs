// Opens Kompass's own Chrome profile so you can log in to job portals yourself.
// Close the window when done; Kompass's Chrome search then reuses the session.
import path from "node:path";
import { chromium } from "playwright";

const dir = path.join(process.env.KOMPASS_DATA ?? path.join(process.cwd(), "data"), "chrome-profile");
const opts = { headless: false, viewport: null, locale: "de-DE" };
const ctx = await chromium.launchPersistentContext(dir, { ...opts, channel: "chrome" }).catch(() => chromium.launchPersistentContext(dir, opts));
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://www.stepstone.de");
console.log("Log in to the portals you want in this window, then close it.");
await new Promise((r) => ctx.on("close", r));
