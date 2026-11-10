/**
 * Background worker: runs queued tasks and the schedules. Started by `npm start` (or launchd).
 * One process per data folder; a lock file stops a second instance.
 */
import fs from "node:fs";
import path from "node:path";
import { all, DATA_DIR, get, getSettings, logEvent, run } from "@/lib/db";
import { isMock, RateLimitError } from "@/lib/claude/runner";
import { notify } from "@/lib/notify";
import { buildStyleGuide, parseDocument } from "@/lib/pipeline/documents";
import { draftApplication } from "@/lib/pipeline/drafting";
import { syncGmail } from "@/lib/pipeline/mailsync";
import { followUpDraft, prepPack } from "@/lib/pipeline/prep";
import { reflectProfile, scoreBatch } from "@/lib/pipeline/scoring";
import { addManualAd, chromePortals, runAlerts, runApis, runJobroom, runChromePortal, runFeeds, runWatchlist } from "@/lib/pipeline/sources";
import { closeBrowser } from "@/lib/sources/chrome";
import { closePdfBrowser } from "@/lib/pipeline/pdf";
import { claim, claudePausedUntil, CLAUDE_TASKS, enqueue, fail, finish, meta, PRIORITY, recoverStale, requeue, setMeta, type Task } from "@/lib/queue";
import type { Portal } from "@/lib/sources/extract";

type Handler = (p: Record<string, unknown>) => Promise<unknown>;

export const handlers: Record<string, Handler> = {
  fetch_source: async (p) => {
    const src = String(p.source);
    if (src === "jobroom") return runJobroom();
    if (src === "watchlist") return runWatchlist();
    if (src === "feeds") return runFeeds();
    if (src === "apis") return runApis();
    if (src === "alerts") return runAlerts();
    if (src === "all") {
      enqueue("fetch_source", { source: "jobroom" }, { priority: PRIORITY.userAction, dedupeKey: "fetch:jobroom" });
      enqueue("fetch_source", { source: "watchlist" }, { priority: PRIORITY.userAction, dedupeKey: "fetch:watchlist" });
      enqueue("fetch_source", { source: "feeds" }, { priority: PRIORITY.userAction, dedupeKey: "fetch:feeds" });
      enqueue("fetch_source", { source: "apis" }, { priority: PRIORITY.userAction, dedupeKey: "fetch:apis" });
      enqueue("fetch_source", { source: "alerts" }, { priority: PRIORITY.userAction, dedupeKey: "fetch:alerts" });
      if (getSettings().chromeEnabled) for (const c of chromePortals()) enqueue("fetch_source", { source: c }, { priority: PRIORITY.source, dedupeKey: `fetch:${c}` });
      return "queued";
    }
    return runChromePortal(src as Portal);
  },
  score_batch: () => scoreBatch(),
  reflect_profile: (p) => reflectProfile(Boolean(p.force)),
  parse_document: (p) => parseDocument(Number(p.docId)),
  style_guide: () => buildStyleGuide(),
  draft: (p) => draftApplication(Number(p.jobId), p.instruction ? String(p.instruction) : undefined),
  prep_pack: (p) => prepPack(Number(p.jobId)),
  follow_up: (p) => followUpDraft(Number(p.jobId)),
  add_manual: (p) => addManualAd(p as never),
  gmail_sync: () => syncGmail(),
};

/* ── schedules ─────────────────────────────────────────── */

function due(name: string, everyMinutes: number, notBeforeHour = 0): boolean {
  const last = meta(`lastRun:${name}`);
  const now = new Date();
  if (now.getHours() < notBeforeHour) return false;
  if (last && now.getTime() - Date.parse(last) < everyMinutes * 60_000) return false;
  setMeta(`lastRun:${name}`, now.toISOString());
  return true;
}

export function schedule() {
  const s = getSettings();
  if (!s.onboarded) return;
  if (due("jobroom", 180, 6)) enqueue("fetch_source", { source: "jobroom" }, { priority: PRIORITY.source, dedupeKey: "fetch:jobroom" });
  if (due("apis", 180, 6)) enqueue("fetch_source", { source: "apis" }, { priority: PRIORITY.source, dedupeKey: "fetch:apis" });
  if (s.gmailAddress && due("gmail", 30, 7)) enqueue("gmail_sync", {}, { priority: PRIORITY.source, dedupeKey: "gmail_sync" });
  if (due("alerts", 120, 6)) enqueue("fetch_source", { source: "alerts" }, { priority: PRIORITY.source, dedupeKey: "fetch:alerts" });
  if (due("feeds", 4 * 60, 6)) enqueue("fetch_source", { source: "feeds" }, { priority: PRIORITY.source, dedupeKey: "fetch:feeds" });
  if (due("watchlist", 24 * 60, 7)) enqueue("fetch_source", { source: "watchlist" }, { priority: PRIORITY.source, dedupeKey: "fetch:watchlist" });
  if (s.chromeEnabled && due("chrome", 6 * 60, 9)) for (const c of chromePortals()) enqueue("fetch_source", { source: c }, { priority: PRIORITY.source, dedupeKey: `fetch:${c}` });
  if (due("reflect", 24 * 60, 3)) enqueue("reflect_profile", {}, { priority: PRIORITY.maintenance, dedupeKey: "reflect" });
  if (due("followups", 24 * 60, 7)) {
    for (const j of all<{ id: number; days: number; next_action: string | null }>(
      "SELECT id, CAST(julianday('now') - julianday(stage_changed_at) AS INTEGER) AS days, next_action FROM jobs WHERE stage = 'applied'",
    )) {
      if (j.days >= 35) run("UPDATE jobs SET next_action = ? WHERE id = ?", [`No reply for ${j.days} days – mark as ghosted?`, j.id]);
      else if (j.days >= 14 && !j.next_action) enqueue("follow_up", { jobId: j.id }, { priority: PRIORITY.research, dedupeKey: `follow:${j.id}` });
    }
  }
  if (due("digest", 24 * 60, 8)) {
    const n = (sql: string) => get<{ n: number }>(sql)!.n;
    const matches = n("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'discover'");
    const drafts = n("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'review'");
    if (matches || drafts) notify("Good morning", `${matches} matches to go through · ${drafts} drafts to review`);
  }
  // catch-up: shortlisted jobs without a draft task, new jobs without a scoring task
  for (const j of all<{ id: number; dream: number }>("SELECT id, dream FROM jobs WHERE stage = 'shortlist' AND COALESCE(prep_sub, '') != 'blocked'")) {
    enqueue("draft", { jobId: j.id }, { priority: j.dream ? PRIORITY.dreamDraft : PRIORITY.draft, dedupeKey: `draft:${j.id}` });
  }
  if (get("SELECT 1 FROM jobs WHERE stage = 'new' LIMIT 1")) enqueue("score_batch", {}, { priority: PRIORITY.score, dedupeKey: "score_batch" });
}

/* ── loop ──────────────────────────────────────────────── */

let running = 0, runningClaude = 0;

async function execute(task: Task) {
  const isClaude = CLAUDE_TASKS.has(task.type);
  running++;
  if (isClaude) runningClaude++;
  const started = Date.now();
  try {
    const out = await handlers[task.type]?.(JSON.parse(task.payload));
    if (!handlers[task.type]) throw new Error(`unknown task ${task.type}`);
    finish(task.id);
    const noise = typeof out === "string" && (/^(queued|Watchlist empty|Chrome search is off|No search profile yet|No API keys|Job alerts off|LinkedIn: already searched today|Gmail not connected|Gmail: nothing to watch)$|^Gmail: 0 new|: 0 new of/.test(out) || (/^(Feeds|APIs):/.test(out) && !/ [1-9]\d*\//.test(out)));
    if (typeof out === "string" && !noise) logEvent(null, "worker", out);
    console.log(`[worker] ${task.type}#${task.id} ok ${Date.now() - started}ms${typeof out === "string" ? ` – ${out}` : ""}`);
  } catch (e) {
    if (e instanceof RateLimitError) {
      setMeta("claudePausedUntil", e.resetAt.toISOString());
      requeue(task.id, e.resetAt);
      logEvent(null, "quota", `Claude usage limit reached – paused until ${e.resetAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`);
      notify("Claude limit reached", `AI work paused until ${e.resetAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`);
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[worker] ${task.type}#${task.id} failed: ${msg}`);
      fail(task, msg, task.type === "fetch_source" ? 2 : 3);
      if (task.type === "draft") {
        const jobId = Number(JSON.parse(task.payload).jobId);
        run("UPDATE jobs SET next_action = ? WHERE id = ? AND stage IN ('shortlist','drafting')", [`Draft failed: ${msg.slice(0, 120)}`, jobId]);
        if (get("SELECT 1 FROM jobs WHERE id = ? AND stage = 'drafting'", [jobId])) run("UPDATE jobs SET stage = 'shortlist', prep_sub = 'queued' WHERE id = ?", [jobId]);
      }
      if (task.type === "parse_document") run("UPDATE documents SET status = 'error', note = ? WHERE id = ?", [msg.slice(0, 200), Number(JSON.parse(task.payload).docId)]);
    }
  } finally {
    running--;
    if (isClaude) runningClaude--;
  }
}

export async function tick() {
  const s = getSettings();
  const maxClaude = Math.max(1, s.claudeParallel);
  while (running < maxClaude + 2) {
    const skipClaude = runningClaude >= maxClaude || !!claudePausedUntil();
    const task = claim(skipClaude);
    if (!task) break;
    void execute(task);
  }
}

/** Runs the queue until it is empty (used by tests and `--drain`). */
export async function drain(timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await tick();
    const pending = get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','running') AND run_after <= datetime('now')")!.n;
    if (!pending && running === 0) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("drain timed out");
}

async function main() {
  const lock = path.join(DATA_DIR, "worker.lock");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    const pid = Number(fs.readFileSync(lock, "utf8"));
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        console.log(`[worker] already running (pid ${pid})`);
        process.exit(0);
      } catch { /* stale lock */ }
    }
  } catch { /* no lock */ }
  fs.writeFileSync(lock, String(process.pid));
  recoverStale();
  console.log(`[worker] started · Claude ${isMock() ? "MOCK mode (CLI not found or mock selected)" : "via Claude Code CLI"}`);
  setMeta("workerHeartbeat", new Date().toISOString());
  let lastSchedule = 0;
  const stop = async () => {
    await closeBrowser();
    await closePdfBrowser();
    try { fs.unlinkSync(lock); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  for (;;) {
    try {
      if (Date.now() - lastSchedule > 60_000) {
        schedule();
        recoverStale();
        lastSchedule = Date.now();
        setMeta("workerHeartbeat", new Date().toISOString());
      }
      await tick();
    } catch (e) {
      console.error("[worker] loop error", e);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

if (process.argv[1] && /worker[/\\]index\.ts$/.test(process.argv[1])) void main();
