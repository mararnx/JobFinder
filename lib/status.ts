import { get, getSettings } from "@/lib/db";
import { isMock } from "@/lib/claude/runner";
import { claudePausedUntil, meta, queueStats } from "@/lib/queue";
import type { ShellStatus } from "@/app/_components/Shell";

export function shellStatus(): ShellStatus {
  const n = (sql: string) => get<{ n: number }>(sql)?.n ?? 0;
  const beat = meta("workerHeartbeat");
  const q = queueStats();
  return {
    counts: {
      discover: n("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'discover'"),
      review: n("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'review'"),
      documents: n("SELECT COUNT(*) AS n FROM documents"),
    },
    claude: {
      mock: isMock(),
      callsWindow: n("SELECT COUNT(*) AS n FROM claude_runs WHERE mock = 0 AND at > datetime('now', '-5 hours')"),
      pausedUntil: claudePausedUntil()?.toISOString() ?? null,
      failing: n("SELECT COUNT(*) AS n FROM claude_runs WHERE ok = 0 AND at > datetime('now', '-1 hour')"),
    },
    worker: { alive: !!beat && Date.now() - Date.parse(beat) < 3 * 60_000, queued: q.queued ?? 0, running: q.running ?? 0 },
    onboarded: getSettings().onboarded,
  };
}
