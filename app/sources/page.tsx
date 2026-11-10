import { all, getSettings } from "@/lib/db";
import { isMock, claudeCli } from "@/lib/claude/runner";
import { searchProfiles } from "@/lib/profile";
import { claudePausedUntil, meta } from "@/lib/queue";
import { pagesUsedToday, portalBlockedToday } from "@/lib/sources/chrome";
import { PORTALS, type Portal } from "@/lib/sources/extract";
import { FEEDS } from "@/lib/sources/feeds";
import { SourcesClient } from "./SourcesClient";

export const dynamic = "force-dynamic";

export default function Sources() {
  const s = getSettings();
  const last = (src: string) => all<{ status: string; started_at: string; added: number; found: number; message: string | null }>("SELECT status, started_at, added, found, message FROM source_runs WHERE source = ? ORDER BY id DESC LIMIT 1", [src])[0] ?? null;
  // a group of sources (feeds, APIs) shown as one: their latest runs combined
  const lastOf = (srcs: string[]) => {
    const runs = srcs.map(last).filter((r) => r !== null);
    if (!runs.length) return null;
    return {
      status: runs.some((r) => r.status === "error") ? "error" : runs.some((r) => r.status === "running") ? "running" : "ok",
      started_at: runs.map((r) => r.started_at).sort().at(-1)!,
      added: runs.reduce((n, r) => n + r.added, 0),
      found: runs.reduce((n, r) => n + r.found, 0),
      message: runs.map((r) => r.message).filter(Boolean).join(" · ") || null,
    };
  };
  const sources = [
    { key: "jobroom", name: "Job-Room (RAV)", kind: "api" as const, detail: "RAV job portal, also ads from jobs.ch, jobup and others · every 3 hours", last: last("jobroom"), used: null, blocked: null },
    { key: "jobsch-api", name: "jobs.ch search", kind: "api" as const, detail: s.jobschApi ? "Largest Swiss portal, via its website search · every 3 hours" : "Not set up – off under More sources", last: last("jobsch-api"), used: null, blocked: null },
    { key: "feeds", name: "Job feeds", kind: "api" as const, detail: `${Object.values(FEEDS).join(", ")} · every 4 hours`, last: lastOf(Object.keys(FEEDS)), used: null, blocked: null },
    { key: "apis", name: "Job search APIs", kind: "api" as const, detail: (s.adzunaAppId && s.adzunaAppKey) || s.joobleKey ? `${[s.adzunaAppId && s.adzunaAppKey ? "Adzuna" : "", s.joobleKey ? "Jooble" : ""].filter(Boolean).join(", ")} · every 3 hours` : "Not set up – add free keys below", last: lastOf(["adzuna", "jooble"]), used: null, blocked: null },
    { key: "alerts", name: "Job alert emails", kind: "api" as const, detail: s.alertsLabel && s.gmailAddress ? `Gmail label “${s.alertsLabel}” · every 2 hours` : "Not set up – see below", last: last("alerts"), used: null, blocked: null },
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
      chromePortals={s.chromePortals}
      gmail={{ address: s.gmailAddress, suggested: s.gmailAddress || (/@(gmail|googlemail)\.com$/i.test(s.email) ? s.email : ""), lastCheck: meta("lastRun:gmail") }}
      more={{ keyword: searchProfiles()[0]?.keywords[0] ?? "", city: searchProfiles()[0]?.location ?? s.home, settings: s }}
      chromeDailyPages={s.chromeDailyPages}
      claude={{ mock: isMock(), cli: cli.ok ? cli.version ?? "installed" : null, mode: s.claudeMode, pausedUntil: claudePausedUntil()?.toISOString() ?? null }}
    />
  );
}
