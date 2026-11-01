import { all, get, run } from "@/lib/db";

export const PRIORITY = { dreamDraft: 10, draft: 20, manual: 25, userAction: 30, parse: 35, score: 50, research: 60, source: 70, maintenance: 90 } as const;

/** Task types that call Claude; these wait while the usage limit is hit. */
export const CLAUDE_TASKS = new Set(["score_batch", "reflect_profile", "initial_profile", "parse_document", "style_guide", "company_brief", "draft", "prep_pack", "follow_up", "add_manual"]);

export type Task = { id: number; type: string; payload: string; priority: number; attempts: number };

export function enqueue(type: string, payload: object = {}, opts: { priority?: number; runAfter?: Date; dedupeKey?: string } = {}): number | null {
  if (opts.dedupeKey) {
    const existing = get<{ id: number }>("SELECT id FROM tasks WHERE dedupe_key = ? AND status = 'queued'", [opts.dedupeKey]);
    if (existing) return null;
  }
  return run("INSERT INTO tasks(type, payload, priority, run_after, dedupe_key) VALUES (?, ?, ?, ?, ?)", [
    type, JSON.stringify(payload), opts.priority ?? 50, (opts.runAfter ?? new Date()).toISOString().replace("T", " ").slice(0, 19), opts.dedupeKey ?? null,
  ]).lastInsertRowid;
}

export function meta(key: string): string | null {
  return get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [`_${key}`])?.value ?? null;
}

export function setMeta(key: string, value: string | null) {
  if (value === null) run("DELETE FROM settings WHERE key = ?", [`_${key}`]);
  else run("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [`_${key}`, value]);
}

export function claudePausedUntil(): Date | null {
  const v = meta("claudePausedUntil");
  if (!v) return null;
  const d = new Date(v);
  return d.getTime() > Date.now() ? d : null;
}

/** Atomically claims the next runnable task, honouring the Claude pause. */
export function claim(skipClaude: boolean): Task | undefined {
  const rows = all<Task>(
    `SELECT id, type, payload, priority, attempts FROM tasks
     WHERE status = 'queued' AND run_after <= datetime('now') ORDER BY priority ASC, id ASC LIMIT 20`,
  );
  for (const t of rows) {
    if (skipClaude && CLAUDE_TASKS.has(t.type)) continue;
    const r = run("UPDATE tasks SET status = 'running', locked_at = datetime('now'), attempts = attempts + 1 WHERE id = ? AND status = 'queued'", [t.id]);
    if (r.changes === 1) return { ...t, attempts: t.attempts + 1 };
  }
  return undefined;
}

export function finish(id: number) {
  run("UPDATE tasks SET status = 'done', finished_at = datetime('now'), error = NULL WHERE id = ?", [id]);
}

export function fail(task: Task, error: string, maxAttempts = 3) {
  if (task.attempts >= maxAttempts) {
    run("UPDATE tasks SET status = 'failed', finished_at = datetime('now'), error = ? WHERE id = ?", [error.slice(0, 1000), task.id]);
  } else {
    const backoffMin = 2 ** task.attempts; // 2, 4, 8 minutes
    run(`UPDATE tasks SET status = 'queued', error = ?, run_after = datetime('now', '+${backoffMin} minutes') WHERE id = ?`, [error.slice(0, 1000), task.id]);
  }
}

/** Puts a task back without counting the attempt (used when Claude is rate-limited). */
export function requeue(id: number, after: Date) {
  run("UPDATE tasks SET status = 'queued', attempts = attempts - 1, run_after = ? WHERE id = ?", [after.toISOString().replace("T", " ").slice(0, 19), id]);
}

/** Tasks left 'running' by a crashed worker go back to the queue. */
export function recoverStale() {
  run("UPDATE tasks SET status = 'queued' WHERE status = 'running' AND locked_at < datetime('now', '-15 minutes')");
}

export function queueStats() {
  return get<{ queued: number; running: number; failed: number }>(
    "SELECT SUM(status='queued') AS queued, SUM(status='running') AS running, SUM(status='failed' AND finished_at > datetime('now','-1 day')) AS failed FROM tasks",
  ) ?? { queued: 0, running: 0, failed: 0 };
}
