import { CalendarRange, FilePenLine, Lightbulb, Target, Timer } from "lucide-react";
import { all, get } from "@/lib/db";

export const dynamic = "force-dynamic";

const REACHED = (stage: string) => `(j.stage IN (${["contact", "round1", "final"].slice(["contact", "round1", "final"].indexOf(stage)).map((s) => `'${s}'`).join(",")}) OR EXISTS (SELECT 1 FROM signals s WHERE s.job_id = j.id AND s.kind IN (${["contact", "round1", "final"].slice(["contact", "round1", "final"].indexOf(stage)).map((s) => `'outcome_${s}'`).join(",")})))`;

export default function Insights() {
  const n = (sql: string) => get<{ n: number }>(sql)?.n ?? 0;
  const funnel: [string, number][] = [
    ["Found", n("SELECT COUNT(*) AS n FROM jobs")],
    ["Passed filters", n("SELECT COUNT(*) AS n FROM jobs WHERE stage != 'excluded'")],
    ["Decided", n("SELECT COUNT(DISTINCT job_id) AS n FROM signals WHERE kind IN ('apply','reject','skip','manual')")],
    ["Applied", n("SELECT COUNT(*) AS n FROM applications WHERE sent_at IS NOT NULL")],
    ["In contact", n(`SELECT COUNT(*) AS n FROM jobs j WHERE ${REACHED("contact")}`)],
    ["Round 1", n(`SELECT COUNT(*) AS n FROM jobs j WHERE ${REACHED("round1")}`)],
    ["Final", n(`SELECT COUNT(*) AS n FROM jobs j WHERE ${REACHED("final")}`)],
  ];
  const bySource = all<{ source: string; sent: number; replied: number }>(`
    SELECT p.source, COUNT(DISTINCT j.id) AS sent, COUNT(DISTINCT CASE WHEN ${REACHED("contact")} THEN j.id END) AS replied
    FROM jobs j JOIN applications a ON a.job_id = j.id AND a.sent_at IS NOT NULL
    JOIN postings p ON p.id = (SELECT MIN(id) FROM postings WHERE job_id = j.id)
    GROUP BY p.source ORDER BY sent DESC`);
  const decisions = all<{ score: number; kind: string }>("SELECT j.score, s.kind FROM signals s JOIN jobs j ON j.id = s.job_id WHERE j.score IS NOT NULL AND s.kind IN ('apply','dream','manual','reject') GROUP BY s.job_id ORDER BY s.id DESC LIMIT 300");
  const reasons = all<{ reason: string; n: number }>("SELECT reason, COUNT(*) AS n FROM signals WHERE kind = 'reject' AND reason IS NOT NULL GROUP BY reason ORDER BY n DESC LIMIT 7");
  const replyDays = get<{ v: number | null }>(`SELECT AVG(julianday(e.at) - julianday(a.sent_at)) AS v FROM applications a JOIN events e ON e.job_id = a.job_id AND e.type = 'stage' AND e.text LIKE '%→ In contact%' WHERE a.sent_at IS NOT NULL AND e.at > a.sent_at`)?.v;
  const reviewSec = get<{ v: number | null }>("SELECT AVG(review_seconds) AS v FROM applications WHERE review_seconds IS NOT NULL")?.v;
  const excluded = all<{ reason: string; n: number }>("SELECT excluded_reason AS reason, COUNT(*) AS n FROM jobs WHERE stage = 'excluded' GROUP BY excluded_reason ORDER BY n DESC LIMIT 5");

  const applied = decisions.filter((d) => d.kind !== "reject");
  const rejected = decisions.filter((d) => d.kind === "reject");
  const correct = decisions.filter((d) => (d.kind === "reject" ? d.score < 75 : d.score >= 75)).length;
  const accuracy = decisions.length ? Math.round((correct / decisions.length) * 100) : null;
  const highRejects = rejected.filter((d) => d.score >= 80).length;
  const best = bySource.filter((s) => s.sent >= 3).sort((a, b) => b.replied / b.sent - a.replied / a.sent)[0];
  const max0 = Math.max(1, funnel[0][1]);
  const maxRate = Math.max(1, ...bySource.map((s) => (s.replied / Math.max(1, s.sent)) * 100));
  const maxReason = Math.max(1, ...reasons.map((r) => r.n));
  const x = (s: number) => 20 + (Math.max(40, Math.min(100, s)) - 40) / 60 * 560;

  return (
    <div className="view-inner enter">
      <section className="hero" style={{ paddingBottom: 20 }}><div className="date"><CalendarRange />All time</div><h1 style={{ fontSize: 44 }}>What <em>works.</em></h1></section>
      <div className="bento">
        <div className="card col-7">
          <div className="card-h">Funnel</div>
          <div className="funnel">
            {funnel.map(([k, v], i) => (
              <div className="f-row" key={k}>
                <span>{k}</span>
                <div className="f-bar"><i style={{ width: `${v ? Math.max(2, Math.sqrt(v / max0) * 100) : 0}%`, animationDelay: `${i * 60}ms` }} /></div>
                <span className="n">{v.toLocaleString("en-US")}{i > 0 && funnel[i - 1][1] ? <small>{Math.round((v / funnel[i - 1][1]) * 100)}%</small> : null}</span>
              </div>
            ))}
            <div className="faint" style={{ fontSize: 11 }}>Bar length uses a square-root scale so small stages stay visible.</div>
          </div>
        </div>
        <div className="card col-5">
          <div className="card-h">Reply rate by source</div>
          <div className="bars">
            {bySource.length ? bySource.map((s) => {
              const rate = Math.round((s.replied / Math.max(1, s.sent)) * 100);
              return <div className="bar-row" key={s.source}><span>{s.source} <span className="faint mono">({s.sent})</span></span><div className="meter"><i style={{ width: `${(rate / maxRate) * 100}%` }} /></div><span className="n">{rate}%</span></div>;
            }) : <p className="faint" style={{ margin: 0, fontSize: 13 }}>Appears once applications are sent.</p>}
          </div>
          {best && <div className="insight"><Lightbulb /><span>{best.source} gets the most replies ({Math.round((best.replied / best.sent) * 100)}%).</span></div>}
        </div>
        <div className="card col-8">
          <div className="card-h">Calibration <span className="muted faint">· score vs. your decision</span></div>
          <div className="calib">
            <svg viewBox="0 0 600 190" role="img" aria-label={`Scatter plot of ${decisions.length} decisions: applied jobs as filled circles, rejected as squares, by score`}>
              {[40, 50, 60, 70, 80, 90, 100].map((v) => <g key={v}><line x1={x(v)} x2={x(v)} y1={10} y2={160} stroke="var(--border)" /><text x={x(v)} y={182} fontSize={11} fill="var(--text-3)" textAnchor="middle" fontFamily="Geist Mono">{v}</text></g>)}
              <text x={24} y={38} fontSize={11} fill="var(--text-3)">applied</text><text x={24} y={128} fontSize={11} fill="var(--text-3)">rejected</text>
              {applied.map((d, i) => <circle key={`a${i}`} cx={x(d.score)} cy={58 + (i % 6) * 6} r={5.5} fill="var(--accent)" stroke="var(--accent-ink)" strokeOpacity={0.25} />)}
              {rejected.map((d, i) => <rect key={`r${i}`} x={x(d.score) - 5} y={98 + (i % 6) * 6 - 5} width={10} height={10} rx={2} fill="none" stroke="var(--text-2)" strokeWidth={1.5} />)}
            </svg>
          </div>
          <div className="insight"><Target /><span>{accuracy == null ? "Make a few decisions and the accuracy shows up here." : `Scores agree with your decisions ${accuracy}% of the time (threshold 75).${highRejects ? ` ${highRejects} rejection(s) scored 80+ – the nightly profile update learns from these.` : ""}`}</span></div>
        </div>
        <div className="card stat col-4">
          <span className="k"><Timer />Avg time to reply</span>
          <span className="v">{replyDays != null ? replyDays.toFixed(1) : "–"} <span style={{ fontSize: 18 }} className="faint">days</span></span>
          <div style={{ marginTop: "auto", paddingTop: 18, borderTop: "1px solid var(--border)" }}>
            <span className="k"><FilePenLine />Avg review time per draft</span>
            <span className="v" style={{ fontSize: 28 }}>{reviewSec ? `${Math.round(reviewSec)} s` : "–"}</span>
            <span className="s">Target under 90 s</span>
          </div>
        </div>
        <div className="card col-6">
          <div className="card-h">Why you reject</div>
          <div className="bars">
            {reasons.length ? reasons.map((r) => <div className="bar-row" key={r.reason}><span>{r.reason}</span><div className="meter"><i style={{ width: `${(r.n / maxReason) * 100}%` }} /></div><span className="n">{r.n}</span></div>) : <p className="faint" style={{ margin: 0, fontSize: 13 }}>No rejections with a reason yet.</p>}
          </div>
        </div>
        <div className="card col-6">
          <div className="card-h">Filtered out automatically</div>
          <div className="bars">
            {excluded.length ? excluded.map((r) => <div className="bar-row" key={r.reason}><span title={r.reason}>{r.reason.length > 22 ? r.reason.slice(0, 21) + "…" : r.reason}</span><div className="meter"><i style={{ width: `${(r.n / Math.max(1, excluded[0].n)) * 100}%` }} /></div><span className="n">{r.n}</span></div>) : <p className="faint" style={{ margin: 0, fontSize: 13 }}>Nothing filtered yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
