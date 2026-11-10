/**
 * Live search test against the real sources, in a throwaway data folder (data-live/).
 *   npx tsx scripts/live-search.ts "Product Owner" Zürich 25 [source,source]
 * Runs Job-Room (RAV), the public feeds and every Chrome portal once, the way the worker would, and prints what each returned.
 * Chrome runs at human pace and stops at the first captcha / login wall (screenshot saved), like in normal use.
 */
import fs from "node:fs";
import path from "node:path";

const [keyword = "Product Owner", city = "Zürich", radius = "25", only] = process.argv.slice(2);
const DIR = path.resolve("data-live");
fs.rmSync(DIR, { recursive: true, force: true });
Object.assign(process.env, { KOMPASS_DATA: DIR, KOMPASS_CLAUDE: process.env.KOMPASS_CLAUDE ?? "mock", KOMPASS_MOCK_DELAY: "0", KOMPASS_NO_NOTIFY: "1" });

const { all, run, setSettings } = await import("@/lib/db");
const { runJobroom, runChromePortal, runFeeds, chromePortals } = await import("@/lib/pipeline/sources");
const { closeBrowser } = await import("@/lib/sources/chrome");

setSettings({ home: city, chromeEnabled: true, chromePortals: ["jobsch", "indeed", "xing", "linkedin"], chromeDailyPages: 15, onboarded: true });
run("INSERT INTO search_profiles(name, keywords, location, radius_km, enabled) VALUES ('Live test', ?, ?, ?, 1)", [JSON.stringify([keyword]), city, Number(radius)]);

console.log(`[live] "${keyword}" in ${city} (+${radius} km)\n`);
const report: { source: string; result: string; seconds: number }[] = [];
const all_ = [["jobroom", () => runJobroom()] as const, ["feeds", () => runFeeds()] as const, ...chromePortals().map((p) => [p, () => runChromePortal(p)] as const)];
for (const [source, fn] of all_.filter(([src]) => !only || only.split(",").includes(src))) {
  const t = Date.now();
  let result: string;
  try {
    result = await fn();
  } catch (e) {
    result = `ERROR ${e instanceof Error ? e.message : e}`;
  }
  const seconds = Math.round((Date.now() - t) / 1000);
  report.push({ source, result, seconds });
  console.log(`[live] ${source}: ${result} (${seconds}s)`);
}
await closeBrowser();

console.log("\n[live] runs:");
for (const r of all<{ source: string; status: string; found: number; added: number; message: string | null }>("SELECT source, status, found, added, message FROM source_runs ORDER BY id")) {
  console.log(`  ${r.source.padEnd(15)} ${r.status.padEnd(8)} found ${String(r.found).padStart(3)}  new ${String(r.added).padStart(3)}  ${r.message ?? ""}`);
}
console.log("\n[live] sample per source:");
const bySource = new Map<string, { title: string; company: string; location: string | null; desc: number }[]>();
for (const r of all<{ source: string; title: string; company: string; location: string | null; desc: number }>(
  "SELECT p.source, j.title, c.name AS company, j.location, length(j.description) AS desc FROM postings p JOIN jobs j ON j.id = p.job_id JOIN companies c ON c.id = j.company_id ORDER BY p.id",
)) {
  const l = bySource.get(r.source) ?? [];
  if (l.length < 4) l.push(r);
  bySource.set(r.source, l);
}
for (const [src, rows] of bySource) {
  console.log(`  ${src}`);
  for (const r of rows) console.log(`    - ${r.title} · ${r.company} · ${r.location ?? "?"} · ${r.desc} chars`);
}
const shots = fs.existsSync(path.join(DIR, "screenshots")) ? fs.readdirSync(path.join(DIR, "screenshots")) : [];
if (shots.length) console.log(`\n[live] friction screenshots in ${path.join(DIR, "screenshots")}: ${shots.join(", ")}`);
process.exit(0);
