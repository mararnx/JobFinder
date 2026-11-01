/**
 * Clicks through the whole UI in a real browser against the production build:
 * every page loads, and the main actions on each one work. Runs on a throwaway copy of the demo data.
 *   npm run test:ui
 * Fails on any page error, console error, 5xx response or failed check.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";

const PORT = 4410;
const BASE = `http://localhost:${PORT}`;

if (!fs.existsSync("data-demo/kompass.db")) spawnSync("npx", ["tsx", "scripts/demo.ts"], { stdio: "inherit" });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "kompass-ui-"));
fs.cpSync("data-demo", data, { recursive: true, filter: (f) => !/worker\.lock|chrome-profile/.test(f) });

const server = spawn("node", ["scripts/start.mjs"], {
  env: { ...process.env, PORT: String(PORT), KOMPASS_DIST_DIR: ".next-test", KOMPASS_DATA: data, KOMPASS_CLAUDE: "mock", KOMPASS_MOCK_DELAY: "0", KOMPASS_DRY_SEND: "1", KOMPASS_NO_NOTIFY: "1" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const stopServer = () => { try { process.kill(-server.pid!, "SIGTERM"); } catch { /* gone */ } };

const problems: string[] = [];
let passed = 0;
let shot: Page | null = null; // screenshot target on failure
const SHOTS = process.env.UI_SHOTS;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✔ ${name}`);
  } catch (e) {
    problems.push(`${name}: ${(e as Error).message.split("\n")[0]}`);
    if (SHOTS && shot) await shot.screenshot({ path: path.join(SHOTS, `${passed + problems.length}.png`) }).catch(() => undefined);
    console.log(`  ✘ ${name}\n    ${process.env.UI_PROBE ? (e as Error).message.slice(0, 1500) : (e as Error).message.split("\n")[0]}`);
  }
}
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function waitForServer() {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server did not start:\n${serverLog.slice(-2000)}`);
}

/** Navigates and waits until React has hydrated, so keys and clicks are handled. */
async function go(page: Page, p: string) {
  const r = await page.goto(BASE + p);
  await page.locator("html[data-ready]").waitFor({ timeout: 15_000 });
  return r;
}

const toast = (page: Page, re: RegExp) => page.locator(".toast").filter({ hasText: re }).first().waitFor({ timeout: 8000 });

try {
  console.log("[ui] starting the app (builds first if the code changed)…");
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  shot = page;
  page.on("pageerror", (e) => problems.push(`page error on ${page.url()}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console error on ${page.url()}: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`${r.status()} for ${r.url()}`); });
  page.on("dialog", (d) => void d.accept());

  console.log("[ui] pages");
  for (const p of ["/", "/discover", "/pipeline", "/review", "/send", "/insights", "/documents", "/sources", "/profile", "/onboarding"]) {
    await check(`${p} loads`, async () => {
      const r = await go(page, p);
      ok(r?.ok(), `status ${r?.status()}`);
      await page.locator("main, .view, h1").first().waitFor({ timeout: 8000 });
    });
  }

  console.log("[ui] today");
  await check("Start triage opens Discover", async () => {
    await go(page, "/");
    await page.getByRole("link", { name: /Start triage/ }).click();
    await page.waitForURL(/\/discover/);
  });

  console.log("[ui] discover");
  await check("A applies to the top match", async () => {
    await go(page, "/discover");
    const title = await page.locator(".tcard h2, .tcard .title").first().textContent();
    await page.keyboard.press("a");
    await toast(page, /shortlist|apply|draft/i);
    await page.waitForTimeout(400);
    const next = await page.locator(".tcard h2, .tcard .title").first().textContent().catch(() => null);
    ok(next !== title, "the card did not advance");
  });
  await check("Reject with a reason", async () => {
    await page.getByRole("button", { name: /Reject/ }).first().click();
    await page.locator(".chip").first().click();
    await toast(page, /reject|closed|not for you|no/i);
  });
  await check("Later and undo", async () => {
    await page.getByRole("button", { name: /^Later/ }).click();
    await page.locator(".toast button", { hasText: "Undo" }).first().click();
  });

  console.log("[ui] pipeline");
  await check("drag a card from Applied to In contact", async () => {
    await go(page, "/pipeline");
    const applied = page.locator("section.col[aria-label='Applied'] .kcard").first();
    const name = (await applied.locator(".t").textContent())!;
    await applied.dragTo(page.locator("section.col[aria-label='In contact']"));
    await toast(page, /In contact/);
    await page.reload();
    await page.locator("html[data-ready]").waitFor();
    await page.locator("section.col[aria-label='In contact'] .kcard .t", { hasText: name }).first().waitFor({ timeout: 8000 });
  });
  await check("] key moves a card one column right", async () => {
    const card = page.locator("section.col[aria-label='In contact'] .kcard").first();
    const name = (await card.locator(".t").textContent())!;
    await card.focus();
    await page.keyboard.press("]");
    await toast(page, /Round 1/);
    await page.reload();
    await page.locator("html[data-ready]").waitFor();
    await page.locator("section.col[aria-label='Round 1'] .kcard .t", { hasText: name }).first().waitFor({ timeout: 8000 });
  });
  await check("drawer: open a card, save a note, move it", async () => {
    await page.locator("section.col[aria-label='Applied'] .kcard").first().click();
    const drawer = page.getByRole("dialog").filter({ has: page.getByText("Move", { exact: true }) });
    await drawer.waitFor({ timeout: 8000 });
    await drawer.getByPlaceholder(/On-site/).fill("Call with HR, Mon 9:00");
    await drawer.getByRole("button", { name: "Save" }).click();
    await toast(page, /saved|note/i);
    await drawer.getByRole("button", { name: /^In contact/ }).click();
    await toast(page, /In contact/);
    await page.keyboard.press("Escape");
  });

  console.log("[ui] review");
  await check("draft shows letter, PDF and email", async () => {
    await go(page, "/review");
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    const src = await page.locator("iframe").first().getAttribute("src");
    ok(src, "no PDF frame");
    const r = await page.request.get(new URL(src!, BASE).toString());
    ok(r.ok() && (r.headers()["content-type"] ?? "").includes("pdf"), `PDF not served (${r.status()})`);
    await page.getByRole("button", { name: "Email", exact: true }).click();
    await page.getByRole("button", { name: "Cover letter", exact: true }).click();
  });
  await check("type straight into the letter, it saves itself", async () => {
    const ed = page.getByRole("textbox", { name: "Cover letter" });
    await ed.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Edited in the UI test.");
    await page.locator(".save-state.saved").waitFor({ timeout: 15_000 });
    await page.reload();
    await page.locator("html[data-ready]").waitFor();
    ok((await page.getByRole("textbox", { name: "Cover letter" }).inputValue()).includes("Edited in the UI test."), "edit not saved");
  });
  await check("edit the email text", async () => {
    await page.getByRole("button", { name: "Email", exact: true }).click();
    const ed = page.getByRole("textbox", { name: "Email text" });
    await ed.fill((await ed.inputValue()) + "\nPS from the test");
    await page.locator(".save-state.saved").waitFor({ timeout: 15_000 });
    await page.getByRole("button", { name: "Cover letter", exact: true }).click();
  });
  await check("rewrite with an instruction", async () => {
    await page.getByRole("button", { name: /^Rewrite R$/ }).click();
    await page.getByPlaceholder(/What should change/).fill("shorter");
    await page.getByPlaceholder(/What should change/).press("Enter");
    await toast(page, /rewrit|draft|claude/i);
  });
  await check("checklist shows and a detail can be edited", async () => {
    await go(page, "/review");
    await page.getByRole("list", { name: "Checklist" }).waitFor();
    const contact = page.locator("label.field", { hasText: "Contact person" }).locator("input");
    await contact.fill("Frau Jansen");
    await contact.press("Enter");
    await toast(page, /letter head updated/i);
  });
  await check("approve moves the draft to Ready to send", async () => {
    await go(page, "/review");
    const company = (await page.locator(".ad-pane > div").first().locator("div > div").first().textContent())!.trim();
    await page.getByRole("button", { name: /^Approve/ }).click();
    const anyway = page.getByRole("button", { name: /Approve anyway/ });
    if (await anyway.isVisible({ timeout: 1500 }).catch(() => false)) await anyway.click();
    await toast(page, /ready to send/i);
    await go(page, "/send");
    await page.locator(".send-row", { hasText: company }).first().waitFor({ timeout: 8000 });
  });

  console.log("[ui] ready to send");
  await check("email: open in Apple Mail, then mark as sent", async () => {
    await go(page, "/send");
    const row = page.locator(".send-row").filter({ has: page.locator("svg.lucide-mail") }).first();
    await row.click();
    const company = (await row.locator(".c").textContent())!;
    await page.getByRole("tab", { name: /By email/ }).click();
    await page.getByRole("button", { name: /Open in Apple Mail/ }).click();
    await toast(page, /dry run|Apple Mail/i);
    await page.getByRole("button", { name: /Mark as sent/ }).click();
    await toast(page, new RegExp(`Sent to ${company}`));
  });
  await check("form: fill in Chrome, copy answers, download parts", async () => {
    await go(page, "/send");
    await page.locator(".send-row").filter({ has: page.locator("svg.lucide-globe") }).first().click();
    await page.getByRole("tab", { name: /Online form/ }).click();
    await page.getByRole("button", { name: /Fill form in Chrome/ }).click();
    await toast(page, /dry run|form/i);
    for (const part of ["", "&part=letter", "&part=cv"]) {
      const href = await page.locator(`a[href*="/api/file"][href$="${part}&download=1"]`).first().getAttribute("href");
      const r = await page.request.get(new URL(href!, BASE).toString());
      ok(r.ok() && (r.headers()["content-type"] ?? "").includes("pdf"), `download ${part || "bundle"} failed (${r.status()})`);
    }
  });
  await check("back to review", async () => {
    await go(page, "/send");
    await page.getByRole("button", { name: /Back to review/ }).click();
    await page.waitForURL(/\/review\?job=/);
  });

  console.log("[ui] shell");
  await check("⌘K palette finds a company and opens it", async () => {
    await go(page, "/pipeline");
    await page.keyboard.press("Meta+k");
    await page.getByRole("dialog", { name: "Command palette" }).getByLabel("Search").fill("Nordlicht");
    await page.locator(".pal-item", { hasText: "Nordlicht" }).first().waitFor({ timeout: 8000 });
    await page.keyboard.press("Enter");
    await page.getByText("Nordlicht Energy").first().waitFor();
    await page.keyboard.press("Escape");
  });
  await check("N adds a pasted ad", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("n");
    const dlg = page.locator("[aria-labelledby='addad-t']");
    await dlg.getByText(/Paste the text/).click();
    await dlg.locator("textarea").fill("Product Owner Logistics (m/w/d)\nHafenkran GmbH, Hamburg\nDu verantwortest das Backlog. Bewerbung an jobs@hafenkran.example");
    await dlg.getByRole("button", { name: /^Add/ }).click();
    await toast(page, /added|Hafenkran/i);
  });
  await check("Fetch sources queues a run", async () => {
    await page.getByRole("button", { name: /Fetch sources/ }).click();
    await toast(page, /fetch|queued|search/i);
  });
  await check("theme toggle switches dark and back", async () => {
    await page.getByRole("button", { name: "Toggle color scheme" }).click();
    ok((await page.locator("html").getAttribute("data-theme")) === "dark", "not dark");
    await page.getByRole("button", { name: "Toggle color scheme" }).click();
    ok((await page.locator("html").getAttribute("data-theme")) === "light", "not light");
  });

  console.log("[ui] setup pages");
  await check("upload a document", async () => {
    await go(page, "/documents");
    const before = await page.locator("[aria-label^='Remove ']").count();
    await page.locator("input[type=file]").setInputFiles("tests/fixtures/docs/Anschreiben_Brandt_2019.txt");
    await page.waitForFunction((n) => document.querySelectorAll("[aria-label^='Remove ']").length > n, before, { timeout: 10_000 });
  });
  await check("add a watchlist company", async () => {
    await go(page, "/sources");
    await page.getByLabel("Company name").fill("Testfirma");
    await page.getByLabel("Careers page URL").fill("https://testfirma.jobs.personio.de");
    await page.getByLabel("Careers page URL").press("Enter");
    await page.getByText("Testfirma").first().waitFor({ timeout: 8000 });
  });
  await check("save settings", async () => {
    await go(page, "/profile");
    await page.locator("form.form-grid button[type=submit]").click();
    await toast(page, /saved/i);
  });
  await check("setup wizard: writing style step saves Claude project instructions", async () => {
    await go(page, "/onboarding");
    await page.getByRole("button", { name: /Let.s go/ }).click();
    await page.getByRole("button", { name: /^(Next|Skip for now)/ }).click();
    await page.getByRole("heading", { name: "How you write" }).waitFor();
    await page.locator("input[aria-label='Upload cover letters']").setInputFiles("tests/fixtures/docs/Anschreiben_Brandt_2019.txt");
    await page.getByLabel("Instructions from your Claude project").fill("Max 250 words. Never use 'hochmotiviert'.");
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("heading", { name: "About you" }).waitFor();
    await go(page, "/profile");
    ok((await page.locator("textarea").filter({ hasText: "Max 250 words" }).count()) === 1, "instructions not in Profile settings");
  });
  await check("setup wizard: more sources step", async () => {
    await go(page, "/onboarding");
    await page.getByRole("button", { name: /Let.s go/ }).click();
    await page.getByRole("button", { name: /^(Next|Skip for now)/ }).click();
    await page.getByRole("button", { name: /^(Next|Skip for now)/ }).click();
    await page.getByRole("button", { name: "Save and continue" }).click();
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("heading", { name: "More places to find jobs" }).waitFor();
    const href = (await page.locator("a.bookmarklet").getAttribute("href")) ?? "";
    ok(href.startsWith("javascript:") && decodeURIComponent(href).includes(`${BASE}/api/capture`), "bookmark button has no capture code");
    await page.getByRole("button", { name: /Connect & check/ }).click();
    await toast(page, /dry run: would read "Job alerts"/);
    const indeed = page.getByLabel("Chrome search on Indeed");
    await indeed.check();
    await page.waitForTimeout(800);
    ok(await indeed.isChecked(), "Indeed switch didn't stay on");
    await indeed.uncheck();
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.getByRole("heading", { name: /Teach it your taste/ }).waitFor();
  });
  await check("“Add to JobFinder” button endpoint adds the posted page", async () => {
    const desc = "Du verantwortest den Checkout. ".repeat(20);
    const html = `<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Product Owner Checkout","hiringOrganization":{"name":"Zalando SE"},"jobLocation":{"address":{"addressLocality":"Berlin"}},"description":"${desc}"}</script></head><body></body></html>`;
    const r = await page.request.post(`${BASE}/api/capture`, { form: { url: "https://de.indeed.com/viewjob?jk=feedbeef12345678", title: "PO", html }, headers: { Origin: "https://de.indeed.com" } });
    ok(r.ok() && (await r.text()).includes("Added to JobFinder"), `capture failed (${r.status()})`);
    await go(page, "/sources");
    await page.getByText("Set up more sources").waitFor();
  });
  await check("learn now rewrites the profile", async () => {
    await go(page, "/profile");
    await page.getByRole("button", { name: /Update now/ }).first().click();
    await toast(page, /updating/i);
  });

  await browser.close();
} catch (e) {
  problems.push(String(e instanceof Error ? e.message : e));
} finally {
  stopServer();
  fs.rmSync(data, { recursive: true, force: true });
}

const unique = [...new Set(problems)];
console.log(`\n[ui] ${passed} checks passed, ${unique.length} problem(s)`);
for (const p of unique) console.log(`  - ${p}`);
process.exit(unique.length ? 1 : 0);
