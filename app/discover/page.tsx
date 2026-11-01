import Link from "next/link";
import { all, get, json } from "@/lib/db";
import { JOB_SELECT, type JobRow } from "@/lib/jobs";
import { fmtSalary, timeAgo } from "@/lib/ui";
import { DiscoverClient, type Card } from "./DiscoverClient";

export const dynamic = "force-dynamic";

export default async function Discover({ searchParams }: { searchParams: Promise<{ later?: string }> }) {
  const later = (await searchParams).later === "1";
  const rows = all<JobRow>(`${JOB_SELECT} WHERE j.stage = ? ORDER BY j.dream DESC, j.manual DESC, j.score DESC, j.found_at DESC LIMIT 200`, [later ? "later" : "discover"]);
  const laterCount = get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'later'")!.n;
  const scoring = get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'new'")!.n;
  const cards: Card[] = rows.map((j) => {
    const sj = json<{ reasons_for: string[]; reasons_against: string[]; red_flags: string[]; dimensions: Record<string, number> } | null>(j.score_json, null);
    return {
      id: j.id, title: j.title, company: j.company, location: j.location ?? "n/a", remote: j.remote ?? "remote n/a",
      salary: fmtSalary(j.salary_min, j.salary_max, j.salary_text), language: (j.language ?? "de").toUpperCase(), score: j.score ?? 0,
      age: timeAgo(j.published_at ?? j.found_at), source: (j.sources ?? "").split(",").join(" · "), dream: !!j.dream, manual: !!j.manual, note: j.note,
      watchlist: !!j.watchlist, url: j.url, reasonsFor: sj?.reasons_for ?? [], reasonsAgainst: sj?.reasons_against ?? [],
      flags: [...(sj?.red_flags ?? []), ...(j.repost_count ? [`Reposted ${j.repost_count}×`] : [])].filter((v, i, a) => a.indexOf(v) === i),
      dims: sj?.dimensions ?? null, excerpt: j.description.replace(/\s+/g, " ").slice(0, 420),
    };
  });
  return (
    <>
      <div className="subnav">
        <Link href="/discover" className={later ? "" : "on"}>To decide</Link>
        <Link href="/discover?later=1" className={later ? "on" : ""}>Saved for later{laterCount ? ` · ${laterCount}` : ""}</Link>
        {scoring > 0 && <span className="tag info spin"><span className="spin-dot" />{scoring} being scored</span>}
      </div>
      <DiscoverClient cards={cards} later={later} />
    </>
  );
}
