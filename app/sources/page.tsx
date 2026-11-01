import { all, getSettings } from "@/lib/db";
import { isMock, claudeCli } from "@/lib/claude/runner";
import { searchProfiles } from "@/lib/profile";
import { claudePausedUntil } from "@/lib/queue";
import { pagesUsedToday, portalBlockedToday } from "@/lib/sources/chrome";
import { PORTALS, type Portal } from "@/lib/sources/extract";
import { SourcesClient } from "./SourcesClient";

export const dynamic = "force-dynamic";

export default function Sources() {
  const s = getSettings();
  const last = (src: string) => all<{ status: string; started_at: string; added: number; found: number; message: string | null }>("SELECT status, started_at, added, found, message FROM source_runs WHERE source = ? ORDER BY id DESC LIMIT 1", [src])[0] ?? null;
  const sources = [
    { key: "arbeitsagentur", name: "Arbeitsagentur", kind: "api" as const, detail: "Public job search API · every 3 hours", last: last("arbeitsagentur"), used: null, blocked: null },
    { key: "watchlist", name: "Company watchlist", kind: "api" as const, detail: "Career-page feeds · daily", last: last("watchlist"), used: null, blocked: null },
    ...(Object.keys(PORTALS) as Portal[]).map((p) => ({ key: p, name: PORTALS[p].name, kind: "chrome" as const, detail: `Chrome · ${pagesUsedToday(p)}/${s.chromeDailyPages} pages today`, last: last(p), used: pagesUsedToday(p), blocked: portalBlockedToday(p) })),
  ];
  const watchlist = all<{ id: number; name: string; ats_type: string | null; careers_url: string | null; jobs: number }>(
    "SELECT c.id, c.name, c.ats_type, c.careers_url, (SELECT COUNT(*) FROM jobs j WHERE j.company_id = c.id) AS jobs FROM companies c WHERE c.watchlist = 1 ORDER BY c.name",
  );
  const blocked = all<{ id: number; name: string }>("SELECT id, name FROM companies WHERE blocked = 1 ORDER BY name");
  const runs = all<{ source: string; status: string; started_at: string; added: number; found: number; message: string | null }>("SELECT source, status, started_at, added, found, message FROM source_runs ORDER BY id DESC LIMIT 12");
  const failed = all<{ id: number; type: string; error: string | null; finished_at: string | null; payload: string }>("SELECT id, type, error, finished_at, payload FROM tasks WHERE status = 'failed' ORDER BY id DESC LIMIT 10");
  const cli = claudeCli();
  return (
    <SourcesClient
      profiles={searchProfiles()}
      sources={sources}
      watchlist={watchlist}
      blocked={blocked}
      runs={runs}
      failed={failed}
      chromeEnabled={s.chromeEnabled}
      chromeDailyPages={s.chromeDailyPages}
      claude={{ mock: isMock(), cli: cli.ok ? cli.version ?? "installed" : null, mode: s.claudeMode, pausedUntil: claudePausedUntil()?.toISOString() ?? null }}
    />
  );
}
