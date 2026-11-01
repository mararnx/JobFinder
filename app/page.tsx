import { Activity, Calendar, ChevronRight, CircleAlert, FileUp, MailQuestion, PenLine, Play, Presentation, ShieldAlert, Sparkles, Star, Send, Brain, Gauge, CopyX, Check } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { all, get, getSettings } from "@/lib/db";
import { JOB_SELECT, type JobRow } from "@/lib/jobs";
import { cvFacts } from "@/lib/profile";
import { clockTime, fmtSalary, parseDb } from "@/lib/ui";
import { JobLink } from "./_components/JobLink";
import { Ring, Tile } from "./_components/ui";

export const dynamic = "force-dynamic";

type Step = { icon: React.ComponentType; title: string; meta: string; time: string; href?: string; job?: number; keys?: string[]; hot?: boolean; warn?: boolean };

export default function Today() {
  const s = getSettings();
  if (!s.onboarded) redirect("/onboarding");
  const n = (sql: string, p: (string | number)[] = []) => get<{ n: number }>(sql, p)?.n ?? 0;

  const found24 = n("SELECT COUNT(*) AS n FROM jobs WHERE found_at > datetime('now','-1 day')");
  const excluded24 = n("SELECT COUNT(*) AS n FROM jobs WHERE found_at > datetime('now','-1 day') AND stage = 'excluded'");
  const discover = n("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'discover'");
  const dreams = n("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'discover' AND (dream = 1 OR score >= 88)");
  const review = n("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'review'");
  const ready = n("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'ready'");
  const avgReview = get<{ v: number | null }>("SELECT AVG(review_seconds) AS v FROM applications WHERE review_seconds IS NOT NULL")?.v;

  const steps: Step[] = [];
  if (!cvFacts()) steps.push({ icon: FileUp, title: "Upload your CV", meta: "Needed before Claude can write applications", time: "≈ 2 min", href: "/documents", warn: true });
  if (discover) steps.push({ icon: Sparkles, title: "Go through new matches", meta: `${discover} jobs${dreams ? ` · ${dreams} strong match${dreams > 1 ? "es" : ""}` : ""}`, time: `≈ ${Math.max(1, Math.round(discover / 3))} min`, href: "/discover", keys: ["G", "D"], hot: true });
  if (review) steps.push({ icon: PenLine, title: "Approve drafts", meta: `${review} application${review > 1 ? "s" : ""}${avgReview ? ` · avg ${Math.round(avgReview)} s review` : ""}`, time: `≈ ${Math.max(1, Math.round((review * (avgReview ?? 90)) / 60))} min`, href: "/review", keys: ["G", "R"] });
  if (ready) steps.push({ icon: Send, title: "Send approved applications", meta: `${ready} ready – by email or the company's form`, time: `≈ ${ready * 2} min`, href: "/send", keys: ["G", "E"] });
  for (const j of all<JobRow>(`${JOB_SELECT} WHERE j.stage = 'applied' AND j.next_action IS NOT NULL ORDER BY j.stage_changed_at LIMIT 3`)) {
    steps.push({ icon: MailQuestion, title: j.next_action!.startsWith("Follow up") ? `Follow up with ${j.company}` : `${j.company}: ${j.next_action}`, meta: `${j.title}`, time: "≈ 1 min", job: j.id });
  }
  for (const j of all<JobRow>(`${JOB_SELECT} WHERE j.stage IN ('contact','round1','final') AND j.next_action IS NOT NULL ORDER BY j.stage_changed_at LIMIT 3`)) {
    steps.push({ icon: Presentation, title: `Prepare: ${j.company}`, meta: j.next_action!, time: "≈ 20 min", job: j.id });
  }
  for (const r of all<{ source: string; message: string | null }>("SELECT source, message FROM source_runs WHERE status = 'blocked' AND started_at > datetime('now','-1 day') GROUP BY source")) {
    steps.push({ icon: ShieldAlert, title: `${r.source} needs you`, meta: `${r.message ?? "Blocked"} · paused today`, time: "≈ 1 min", href: "/sources", warn: true });
  }
  const failedDrafts = n("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'shortlist' AND next_action LIKE 'Draft failed%'");
  if (failedDrafts) steps.push({ icon: CircleAlert, title: `${failedDrafts} draft${failedDrafts > 1 ? "s" : ""} failed`, meta: "Open the pipeline to retry", time: "≈ 1 min", href: "/pipeline", warn: true });

  // week: applications sent per weekday (Mon..Sun)
  const now = new Date();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sent = all<{ sent_at: string }>("SELECT sent_at FROM applications WHERE sent_at IS NOT NULL AND sent_at >= ?", [monday.toISOString().replace("T", " ").slice(0, 19)]);
  const week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => [d, sent.filter((x) => (new Date(parseDb(x.sent_at)).getDay() + 6) % 7 === i).length] as const);
  const sentWeek = sent.length;
  const lastWeek = n("SELECT COUNT(*) AS n FROM applications WHERE sent_at >= ? AND sent_at < ?", [new Date(monday.getTime() - 7 * 86_400_000).toISOString().replace("T", " ").slice(0, 19), monday.toISOString().replace("T", " ").slice(0, 19)]);
  const maxDay = Math.max(1, ...week.map((w) => w[1]));
  const todayIdx = (now.getDay() + 6) % 7;
  const goalPct = Math.min(100, Math.round((sentWeek / Math.max(1, s.weeklyGoal)) * 100));

  const top = get<JobRow>(`${JOB_SELECT} WHERE j.stage = 'discover' ORDER BY j.dream DESC, j.score DESC LIMIT 1`);
  const nextUp = top ? all<JobRow>(`${JOB_SELECT} WHERE j.stage = 'discover' AND j.id != ? ORDER BY j.dream DESC, j.score DESC LIMIT 3`, [top.id]) : [];
  const topSalary = top ? fmtSalary(top.salary_min, top.salary_max, top.salary_text) : "n/a";
  const topReasons = top?.score_json ? (JSON.parse(top.score_json) as { reasons_for: string[]; reasons_against: string[] }) : null;
  const feed = all<{ type: string; text: string; at: string; job_id: number | null }>("SELECT type, text, at, job_id FROM events WHERE type IN ('worker','draft','profile','quota','source','documents','approved','prep') ORDER BY id DESC LIMIT 6");
  const greeting = now.getHours() < 11 ? "Good morning" : now.getHours() < 18 ? "Hello" : "Good evening";
  const first = s.name.split(" ")[0];
  const totalMin = steps.reduce((a, x) => a + Number(x.time.match(/\d+/)?.[0] ?? 0), 0);

  return (
    <div className="view-inner enter">
      <section className="hero today-hero">
        <div>
          <div className="date"><Calendar />{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
          <h1>{greeting}{first ? `, ${first}` : ""}.</h1>
          <p>
            {found24 ? <>In the last 24 hours, <b>{found24} new ads</b> came in. JobFinder filtered out {excluded24}, </> : <>No new ads in the last 24 hours. </>}
            <b>{discover} {discover === 1 ? "is" : "are"} waiting</b> for you{dreams ? <>, {dreams} of them strong</> : null}.
          </p>
          <div className="cta-row">
            {discover > 0 && <Link className="btn primary lg" href="/discover"><Play />Start triage <kbd>G</kbd><kbd>D</kbd></Link>}
            {review > 0 && <Link className="btn lg" href="/review"><PenLine />Review {review} draft{review > 1 ? "s" : ""}</Link>}
            {ready > 0 && <Link className="btn lg" href="/send"><Send />Send {ready}</Link>}
            {!discover && !review && !ready && <Link className="btn lg" href="/pipeline">Open pipeline</Link>}
          </div>
        </div>
        <div className="goal card" aria-label={`Weekly goal: ${sentWeek} of ${s.weeklyGoal} applications`}>
          <Ring score={goalPct} size={112} stroke={7} label={false} />
          <div className="goal-txt">
            <span className="v mono">{sentWeek}<span className="faint">/{s.weeklyGoal}</span></span>
            <span className="k">{sentWeek >= s.weeklyGoal ? "Weekly goal reached" : "Applications this week"}</span>
            <span className="s">{sentWeek - lastWeek >= 0 ? <span className="up">▲ {sentWeek - lastWeek}</span> : <span style={{ color: "var(--danger)" }}>▼ {lastWeek - sentWeek}</span>} vs. last week</span>
          </div>
        </div>
      </section>

      <div className="bento">
        <div className="card col-7">
          <div className="card-h">Next steps {steps.length > 0 && <span className="muted faint">· ≈ {totalMin} min total</span>}</div>
          {steps.length ? (
            <ol className="steps">
              {steps.slice(0, 6).map((st, i) => {
                const Icon = st.icon;
                const inner = (
                  <>
                    <span className="step-n mono">{i + 1}</span>
                    <span className={`feed-dot${st.hot ? " hot" : ""}`}><Icon /></span>
                    <span className="grow"><span className="t">{st.title}</span><span className="m">{st.meta}</span></span>
                    <span className="time mono">{st.time}</span>
                    {st.keys ? <span className="keys">{st.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span> : <ChevronRight className="chev" />}
                  </>
                );
                return (
                  <li key={i}>
                    {st.href ? <Link className={`step${st.warn ? " warn" : ""}`} href={st.href}>{inner}</Link> : <JobLink id={st.job!} className={`step${st.warn ? " warn" : ""}`}>{inner}</JobLink>}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="empty"><Check /><div><b>Nothing to do right now.</b><span>JobFinder keeps searching in the background and lets you know.</span></div></div>
          )}
        </div>

        <div className="card col-5 topmatch">
          <div className="card-h">{top?.dream ? <Star style={{ color: "var(--dream)" }} /> : <Sparkles />}{top?.dream ? "Dream job waiting" : "Top match"}{top?.sources && <span className="right tag">{top.sources.split(",")[0]}</span>}</div>
          {top ? (
            <div className="tm-body">
              <div className="tm-top">
                <Tile name={top.company} />
                <div className="grow"><div className="t">{top.title}</div><div className="faint" style={{ fontSize: 12 }}>{[top.company, top.location].filter(Boolean).join(" · ")}{topSalary !== "n/a" && <> · <span className="mono">{topSalary}</span></>}</div></div>
                <Ring score={top.score} size={56} stroke={4} />
              </div>
              {topReasons && (
                <ul className="tm-why">
                  {topReasons.reasons_for.slice(0, 2).map((r) => <li key={r}><Check style={{ color: "var(--ok)" }} />{r}</li>)}
                  {topReasons.reasons_against.slice(0, 1).map((r) => <li key={r}><span style={{ color: "var(--dream)", width: 14 }}>–</span>{r}</li>)}
                </ul>
              )}
              {nextUp.length > 0 && (
                <div className="tm-next">
                  <div className="tm-next-h">Also waiting</div>
                  {nextUp.map((j) => (
                    <JobLink key={j.id} id={j.id} className="tm-next-row">
                      <Tile name={j.company} small />
                      <span className="grow"><span className="t">{j.title}</span><span className="c">{j.company}</span></span>
                      <Ring score={j.score} size={28} stroke={2.5} />
                    </JobLink>
                  ))}
                </div>
              )}
              <div className="tm-actions"><Link className="btn primary" href="/discover"><Send />Decide in Discover</Link><JobLink id={top.id} className="btn ghost">Details</JobLink></div>
            </div>
          ) : (
            <div className="empty"><Sparkles /><div><b>No matches waiting.</b><span>New ads are fetched every 3 hours.</span></div></div>
          )}
        </div>

        <div className="card col-7">
          <div className="card-h"><Activity />Agent activity</div>
          <div className="feed">
            {feed.length ? feed.map((f, i) => (
              <div className="feed-item" key={i}>
                <span className="feed-dot">{f.type === "draft" ? <PenLine /> : f.type === "profile" ? <Brain /> : f.type === "worker" ? <Gauge /> : f.type === "quota" || f.type === "source" ? <ShieldAlert /> : <CopyX />}</span>
                <span>{f.text}</span><time>{clockTime(f.at)}</time>
              </div>
            )) : <div className="feed-item"><span className="faint">Nothing yet – the worker logs its work here.</span></div>}
          </div>
        </div>
        <div className="card col-5">
          <div className="card-h">Applications this week<span className="right mono faint">{sentWeek}</span></div>
          <div className="week" role="img" aria-label={`Applications per day: ${week.map(([d, v]) => `${d} ${v}`).join(", ")}`}>
            {week.map(([d, v], i) => (
              <div className={`wk${i === todayIdx ? " today" : ""}`} key={d}><span className="mono">{v || "\u00a0"}</span><i className={v ? "on" : ""} style={{ height: `${Math.max(4, (v / maxDay) * 100)}%` }} /><span className="d">{i === todayIdx ? "Today" : d}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
