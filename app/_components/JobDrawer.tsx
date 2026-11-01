"use client";

import { Ban, CalendarClock, Check, ExternalLink, FileText, Mail, MousePointerClick, Presentation, Send, Star, X, Ghost, ArrowRightLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { act, toast } from "@/lib/client";
import { fmtSalary, timeAgo } from "@/lib/ui";
import { Markdown, Ring, Tile } from "./ui";
import { useRestoreFocus } from "./useRestoreFocus";

type JobData = {
  job: {
    id: number; title: string; company: string; location: string | null; remote: string | null; salary_min: number | null; salary_max: number | null; salary_text: string | null;
    description: string; url: string | null; apply_email: string | null; stage: string; score: number | null; dream: number; manual: number; note: string | null; next_action: string | null;
    closed_reason: string | null; excluded_reason: string | null; language: string | null; repost_count: number;
    score_json: { reasons_for: string[]; reasons_against: string[]; red_flags: string[]; summary: string } | null;
  };
  company: { brief_md: string | null; watchlist: number; blocked: number } | null;
  postings: { source: string; url: string | null }[];
  events: { type: string; text: string; at: string }[];
  application: { id: number; version: number; subject: string; status: string; bundle_path: string | null; sent_at: string | null } | null;
  prep: { markdown: string; created_at: string } | null;
  followUp: { subject: string; body: string } | null;
};

const MOVES = [
  { to: "prep", label: "Preparing (draft)" }, { to: "applied", label: "Applied" }, { to: "contact", label: "In contact" },
  { to: "round1", label: "Round 1 (interview)" }, { to: "final", label: "Final" },
];
const STAGE_COL: Record<string, string> = { shortlist: "prep", drafting: "prep", review: "prep", applied: "applied", contact: "contact", round1: "round1", final: "final" };
const CLOSE = ["rejected", "ghosted", "withdrawn", "offer declined", "accepted 🎉"];

export function JobDrawer() {
  const router = useRouter();
  const [id, setId] = useState<number | null>(null);
  const [data, setData] = useState<JobData | null>(null);
  const [tab, setTab] = useState<"overview" | "ad" | "prep">("overview");
  const [note, setNote] = useState("");
  const closeBtn = useRef<HTMLButtonElement>(null);

  const load = useCallback(async (jobId: number) => {
    const r = await fetch(`/api/job?id=${jobId}`);
    if (r.ok) {
      const d = (await r.json()) as JobData;
      setData(d);
      setNote(d.job.next_action ?? "");
    }
  }, []);

  useEffect(() => {
    const on = (e: Event) => {
      const jobId = (e as CustomEvent<number>).detail;
      setId(jobId);
      setTab("overview");
      setData(null);
      void load(jobId);
      setTimeout(() => closeBtn.current?.focus(), 50);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setId(null);
    window.addEventListener("kompass:job", on);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("kompass:job", on);
      window.removeEventListener("keydown", esc);
    };
  }, [load]);

  useEffect(() => {
    if (!id || !data) return;
    const t = setInterval(() => void load(id), 5000);
    return () => clearInterval(t);
  }, [id, data, load]);

  const run = async (action: string, args: Record<string, unknown>, msg: string, undo?: () => void) => {
    try {
      const r = await act<{ message?: string; ok?: boolean }>(action, args);
      toast(r && typeof r === "object" && "message" in r && r.message ? r.message : msg, undo);
      if (id) void load(id);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    }
  };

  const open = id !== null;
  useRestoreFocus(open);
  const j = data?.job;
  const stage = j?.stage ?? "";
  const close = () => setId(null);

  return (
    <>
      <div className={`scrim${open ? " show" : ""}`} onClick={close} />
      <aside className={`drawer${open ? " show" : ""}`} role="dialog" aria-modal="true" aria-label="Job details">
        {!j ? (
          <div className="drawer-b"><div className="skeleton" style={{ height: 60 }} /><div className="skeleton" style={{ height: 200, marginTop: 16 }} /></div>
        ) : (
          <>
            <div className="drawer-h">
              <Tile name={j.company} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2>{j.title}</h2>
                <div className="muted">{j.company} · {j.location ?? "location n/a"}{j.dream ? " · " : ""}{j.dream ? <span style={{ color: "var(--dream)" }}>★ dream job</span> : null}</div>
              </div>
              <Ring score={j.score} size={48} />
              <button ref={closeBtn} className="icon-btn" onClick={close} aria-label="Close"><X /></button>
            </div>
            <div className="drawer-tabs seg" role="tablist">
              {(["overview", "ad", ...(data!.prep ? ["prep"] : [])] as const).map((t) => (
                <button key={t} role="tab" aria-pressed={tab === t} onClick={() => setTab(t as typeof tab)}>{t === "overview" ? "Overview" : t === "ad" ? "Job ad" : "Prep pack"}</button>
              ))}
            </div>
            <div className="drawer-b">
              {tab === "ad" && <div className="ad-text">{j.description || "No description stored."}</div>}
              {tab === "prep" && data!.prep && <Markdown text={data!.prep.markdown} />}
              {tab === "overview" && (
                <>
                  <div className="section-t">Next step</div>
                  <div className="card next-card">
                    <CalendarClock style={{ color: "var(--accent-fg)" }} />
                    <div style={{ flex: 1 }}>{nextStepText(stage, j, data!)}</div>
                    {stage === "review" && <Link className="btn" href={`/review?job=${j.id}`} onClick={close}>Open</Link>}
                  </div>

                  <div className="drawer-actions">
                    {(stage === "review" || stage === "applied") && data!.application?.bundle_path && (
                      <a className="btn" href={`/api/file?app=${data!.application.id}`} target="_blank" rel="noreferrer"><FileText />PDF</a>
                    )}
                    {data!.application?.status === "approved" && (
                      <>
                        {j.apply_email && <button className="btn" onClick={() => run("openMail", { jobId: j.id }, "Mail draft opened")}><Mail />Open mail draft</button>}
                        {j.url && <button className="btn" onClick={() => run("openForm", { jobId: j.id }, "Form opened")}><MousePointerClick />Open form</button>}
                        <button className="btn primary" onClick={() => run("markSent", { jobId: j.id }, "Marked as sent – good luck!")}><Send />Mark as sent</button>
                      </>
                    )}
                    {["discover", "later"].includes(stage) && (
                      <>
                        <button className="btn primary" onClick={() => run("decide", { jobId: j.id, kind: "apply" }, "Shortlisted · Claude is writing the draft")}><Send />Apply</button>
                        <button className="btn" onClick={() => run("decide", { jobId: j.id, kind: j.dream ? "undream" : "dream" }, j.dream ? "Dream job removed" : "Marked as dream job")}><Star />{j.dream ? "Undream" : "Dream job"}</button>
                      </>
                    )}
                    {stage === "round1" && !data!.prep && <button className="btn" onClick={() => run("prepPack", { jobId: j.id }, "Creating prep pack…")}><Presentation />Prep pack</button>}
                    {j.url && <a className="btn ghost" href={j.url} target="_blank" rel="noreferrer"><ExternalLink />Original ad</a>}
                  </div>

                  {!["new", "excluded"].includes(stage) && (
                    <>
                      <div className="section-t">Move</div>
                      <div className="chips">
                        {MOVES.map((m) => (
                          <button key={m.to} className="chip" aria-current={STAGE_COL[stage] === m.to} disabled={STAGE_COL[stage] === m.to} onClick={() => run("move", { jobId: j.id, to: m.to }, `Moved to ${m.label}`)}><ArrowRightLeft />{m.label}</button>
                        ))}
                        {CLOSE.map((c) => (
                          <button key={c} className="chip" onClick={() => run("move", { jobId: j.id, to: "closed", closedReason: c }, `Closed: ${c}`)}>{c === "ghosted" ? <Ghost /> : <X />}{c}</button>
                        ))}
                      </div>
                      <div className="section-t">Note / next appointment</div>
                      <form className="note-row" onSubmit={(e) => { e.preventDefault(); void run("setNote", { jobId: j.id, note }, "Saved"); }}>
                        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. On-site Tue 10:30, ask for Ms Jansen" aria-label="Note" />
                        <button className="btn" type="submit"><Check />Save</button>
                      </form>
                    </>
                  )}

                  {data!.followUp && stage === "applied" && (
                    <>
                      <div className="section-t">Follow-up draft</div>
                      <div className="card" style={{ padding: 14, fontSize: 13 }}>
                        <b>{data!.followUp.subject}</b>
                        <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", color: "var(--text-2)" }}>{data!.followUp.body}</p>
                        <button className="btn sm" style={{ marginTop: 8, marginLeft: 0 }} onClick={() => { void navigator.clipboard.writeText(`${data!.followUp!.subject}\n\n${data!.followUp!.body}`); toast("Copied"); }}>Copy</button>
                      </div>
                    </>
                  )}

                  {j.score_json && (
                    <>
                      <div className="section-t">Why this score</div>
                      <ul className="tm-why">
                        {j.score_json.reasons_for.map((r) => <li key={r}><Check style={{ color: "var(--ok)" }} />{r}</li>)}
                        {j.score_json.reasons_against.map((r) => <li key={r}><X style={{ color: "var(--dream)" }} />{r}</li>)}
                      </ul>
                    </>
                  )}

                  <div className="facts" style={{ margin: "14px 0 0" }}>
                    <span className="tag">{j.remote ?? "remote n/a"}</span>
                    <span className="tag mono">{fmtSalary(j.salary_min, j.salary_max, j.salary_text)}</span>
                    {j.language && <span className="tag">{j.language.toUpperCase()}</span>}
                    {j.manual ? <span className="tag accent">Manual</span> : null}
                    {data!.company?.watchlist ? <span className="tag accent">Watchlist</span> : null}
                    {j.repost_count > 0 && <span className="tag warn">Reposted {j.repost_count}×</span>}
                    {data!.postings.map((p) => <span key={p.source + p.url} className="tag">{p.source}</span>)}
                  </div>

                  <div className="section-t">Timeline</div>
                  <ul className="timeline">
                    {data!.events.map((e, i) => (
                      <li key={i}><span className="feed-dot"><EventIcon type={e.type} /></span><div>{e.text}<time>{timeAgo(e.at)}</time></div></li>
                    ))}
                  </ul>

                  {data!.company?.brief_md && (
                    <>
                      <div className="section-t">Company brief</div>
                      <Markdown text={data!.company.brief_md} />
                    </>
                  )}
                  {!data!.company?.blocked && (
                    <button className="btn ghost sm" style={{ marginTop: 18, color: "var(--danger)" }} onClick={() => run("blockCompany", { jobId: j.id }, `${j.company} blocked – no more ads from them`)}><Ban />Never show this company again</button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function nextStepText(stage: string, j: JobData["job"], d: JobData) {
  if (j.next_action) return j.next_action;
  switch (stage) {
    case "new": return "Waiting to be scored";
    case "excluded": return `Filtered out: ${j.excluded_reason}`;
    case "discover": case "later": return "Decide: apply, dream job or reject";
    case "shortlist": return "Queued – Claude will write the draft";
    case "drafting": return "Claude is writing the application…";
    case "review": return "Review and approve the draft";
    case "applied": return d.application?.status === "approved" ? "Send it, then mark as sent" : "Waiting for a reply";
    case "contact": return "Add the next appointment as a note";
    case "round1": return d.prep ? "Prep pack is ready – see the tab above" : "Interview coming up – create a prep pack";
    case "final": return "Final round – good luck!";
    case "closed": return `Closed: ${j.closed_reason ?? ""}`;
    default: return "";
  }
}

function EventIcon({ type }: { type: string }) {
  const map: Record<string, React.ComponentType> = { found: Star, scored: Check, draft: FileText, approved: Check, mail: Mail, form: MousePointerClick, stage: ArrowRightLeft, excluded: Ban, prep: Presentation, note: CalendarClock };
  const I = map[type] ?? Check;
  return <I />;
}
