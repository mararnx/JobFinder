"use client";

import { Check, CircleCheck, CircleDot, Circle, ExternalLink, FileText, Info, LoaderCircle, Mail, MousePointerClick, Pencil, Send, ShieldCheck, ShieldAlert, Star, WandSparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { act, toast } from "@/lib/client";
import { Tile } from "../_components/ui";

type Claim = { text: string; status: "ok" | "reworded" | "unsupported"; fact_id?: string | null; note: string };
export type ReviewItem = {
  jobId: number; appId: number; title: string; company: string; location: string | null; dream: boolean; language: string; url: string | null;
  channel: "email" | "form" | "none"; applyEmail: string | null; version: number; subject: string; letter: string; emailBody: string; status: string;
  coverage: { requirement: string; status: "covered" | "partial" | "missing"; where: string }[]; claims: Claim[];
  answers: { salary: string; start_date: string; notice_period: string; why_us: string; recipient?: string | null }; hasPdf: boolean; createdAt: string;
};

function highlight(letter: string, claims: Claim[]) {
  type Part = { text: string; claim?: Claim };
  let parts: Part[] = [{ text: letter }];
  for (const c of claims) {
    const needle = c.text.trim();
    if (needle.length < 8) continue;
    parts = parts.flatMap((p) => {
      if (p.claim) return [p];
      const i = p.text.indexOf(needle);
      if (i < 0) return [p];
      return [{ text: p.text.slice(0, i) }, { text: needle, claim: c }, { text: p.text.slice(i + needle.length) }];
    });
  }
  return parts;
}

export function ReviewClient({ items, initialJob, profile }: { items: ReviewItem[]; initialJob: number | null; profile: { salary: string; start: string; notice: string } }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<number>(initialJob && items.some((i) => i.jobId === initialJob) ? initialJob : items[0].jobId);
  const item = items.find((i) => i.jobId === jobId) ?? items[0];
  const [tab, setTab] = useState<"letter" | "pdf" | "email">("letter");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.letter);
  const [rewrite, setRewrite] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [warned, setWarned] = useState(false);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    setDraft(item.letter);
    setEditing(false);
    setRewrite(null);
    setWarned(false);
    setTab("letter");
    shownAt.current = Date.now();
  }, [item.appId, item.letter]);

  const counts = useMemo(() => ({
    ok: item.claims.filter((c) => c.status === "ok").length,
    reworded: item.claims.filter((c) => c.status === "reworded").length,
    unsupported: item.claims.filter((c) => c.status === "unsupported").length,
  }), [item.claims]);
  const pending = items.filter((i) => i.status !== "approved");
  const pos = items.findIndex((i) => i.jobId === item.jobId);

  const go = useCallback((delta: number) => {
    const n = items[(pos + delta + items.length) % items.length];
    if (n) setJobId(n.jobId);
  }, [items, pos]);

  const save = async () => {
    setBusy("save");
    try {
      await act("saveLetter", { appId: item.appId, letter: draft });
      toast("Saved · PDF updated");
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    } finally {
      setBusy(null);
    }
  };

  const approve = useCallback(async () => {
    if (counts.unsupported && !warned) {
      setWarned(true);
      return;
    }
    setBusy("approve");
    try {
      if (editing && draft !== item.letter) await act("saveLetter", { appId: item.appId, letter: draft });
      const r = await act<{ ok: boolean; message: string; channel: string }>("approve", { appId: item.appId, seconds: (Date.now() - shownAt.current) / 1000 });
      toast(r.message, undefined, r.ok ? "ok" : "error");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    } finally {
      setBusy(null);
    }
  }, [counts.unsupported, warned, editing, draft, item, router]);

  const markSent = async () => {
    setBusy("sent");
    try {
      await act("markSent", { jobId: item.jobId });
      toast(`Marked as sent – good luck with ${item.company}!`);
      const next = pending.find((i) => i.jobId !== item.jobId) ?? items.find((i) => i.jobId !== item.jobId);
      if (next) setJobId(next.jobId);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const doRewrite = async () => {
    setBusy("rewrite");
    try {
      await act("regenerate", { jobId: item.jobId, instruction: rewrite ?? "" });
      toast("Claude is rewriting – it comes back here when done");
      setRewrite(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !document.querySelector(".palette.show")) {
        e.preventDefault();
        if (item.status === "approved") void markSent();
        else void approve();
        return;
      }
      if (t.closest?.("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".palette.show, .drawer.show")) return;
      const k = e.key.toLowerCase();
      if (k === "j") go(1);
      if (k === "k") go(-1);
      if (k === "e") setEditing(true);
      if (k === "r") { e.preventDefault(); setRewrite(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const parts = highlight(item.letter, item.claims);

  return (
    <div className="review">
      <section className="ad-pane enter">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Tile name={item.company} />
          <div><div style={{ fontWeight: 500 }}>{item.company}</div><div className="faint" style={{ fontSize: 12 }}>{item.location ?? ""} · draft v{item.version}</div></div>
          <div className="pager">
            <button className="icon-btn" onClick={() => go(-1)} aria-label="Previous draft">‹</button>
            <span className="tag">{pos + 1} of {items.length}</span>
            <button className="icon-btn" onClick={() => go(1)} aria-label="Next draft">›</button>
          </div>
        </div>
        <h2>{item.title}</h2>
        <div className="facts" style={{ margin: "10px 0 0" }}>
          {item.channel === "email" ? <span className="tag accent"><Mail />Apply by email</span> : item.channel === "form" ? <span className="tag accent"><MousePointerClick />Online form</span> : <span className="tag warn"><Info />No apply route found</span>}
          <span className="tag">{item.language.toUpperCase()}</span>
          {item.dream && <span className="tag warn"><Star />Dream job</span>}
          {item.url && <a className="tag" href={item.url} target="_blank" rel="noreferrer"><ExternalLink />Ad</a>}
        </div>
        <h4>Requirements from the ad</h4>
        <ul className="req">
          {item.coverage.length ? item.coverage.map((c) => (
            <li key={c.requirement} className={c.status}>
              {c.status === "covered" ? <CircleCheck /> : c.status === "partial" ? <CircleDot /> : <Circle />}{c.requirement}<span className="s">{c.where}</span>
            </li>
          )) : <li className="faint">No requirements extracted</li>}
        </ul>
        <h4>Required details</h4>
        <div className="fields">
          <div className="field"><label>Salary expectation</label><div className="mono">{item.answers.salary || profile.salary || "—"}</div></div>
          <div className="field"><label>Earliest start</label><div>{item.answers.start_date || profile.start || "—"}</div></div>
          <div className="field"><label>Notice period</label><div>{item.answers.notice_period || profile.notice || "—"}</div></div>
          <div className="field"><label>Contact person</label><div>{item.answers.recipient || "—"}</div></div>
        </div>
        {item.answers.why_us && <><h4>“Why us” answer for forms</h4><p className="muted" style={{ fontSize: 13, margin: 0 }}>{item.answers.why_us}</p></>}
      </section>

      <section className="letter-pane">
        <div className="letter-tools">
          <div className="seg" role="group" aria-label="Document">
            <button aria-pressed={tab === "letter"} onClick={() => setTab("letter")}>Cover letter</button>
            <button aria-pressed={tab === "pdf"} onClick={() => setTab("pdf")}>PDF</button>
            <button aria-pressed={tab === "email"} onClick={() => setTab("email")}>Email</button>
          </div>
          <span className="tag ok" style={{ marginLeft: "auto" }}><ShieldCheck />{counts.ok} backed</span>
          {counts.reworded > 0 && <span className="tag warn"><Info />{counts.reworded} reworded</span>}
          {counts.unsupported > 0 && <span className="tag bad"><ShieldAlert />{counts.unsupported} unsupported</span>}
          {tab === "letter" && !editing && <button className="btn ghost sm" onClick={() => setEditing(true)}><Pencil />Edit <kbd>E</kbd></button>}
        </div>
        <div className="letter-scroll">
          {tab === "letter" && (
            <div className="paper">
              <div className="subj">{item.subject}</div>
              {editing ? (
                <textarea className="letter-edit" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Edit cover letter" autoFocus />
              ) : (
                <div className="letter-text">
                  {parts.map((p, i) => p.claim ? (
                    <span key={i} className={`claim ${p.claim.status === "ok" ? "ok" : p.claim.status === "reworded" ? "warn" : "bad"}`} title={`${p.claim.status === "ok" ? "Backed" : p.claim.status === "reworded" ? "Reworded" : "Not in your CV"}${p.claim.fact_id ? ` (${p.claim.fact_id})` : ""}: ${p.claim.note}`}>{p.text}</span>
                  ) : <span key={i}>{p.text}</span>)}
                </div>
              )}
              {editing && <div className="edit-bar"><button className="btn ghost" onClick={() => { setDraft(item.letter); setEditing(false); }}>Cancel</button><button className="btn" onClick={save} disabled={busy === "save"}><Check />Save</button></div>}
            </div>
          )}
          {tab === "pdf" && (item.hasPdf ? <iframe className="pdf-frame" src={`/api/file?app=${item.appId}#view=FitH`} title="Application PDF" /> : <p className="muted">No PDF yet.</p>)}
          {tab === "email" && (
            <div className="paper">
              <div className="addr">To: {item.applyEmail ?? "(no email in the ad)"}</div>
              <div className="subj">{item.subject}</div>
              <div className="letter-text">{item.emailBody}</div>
              <div className="addr" style={{ marginTop: 20 }}><FileText style={{ verticalAlign: "-3px" }} /> PDF attached</div>
            </div>
          )}
        </div>
        {rewrite !== null && (
          <form className="rewrite-bar" onSubmit={(e) => { e.preventDefault(); void doRewrite(); }}>
            <WandSparkles />
            <input className="input" autoFocus value={rewrite} onChange={(e) => setRewrite(e.target.value)} placeholder="What should change? e.g. shorter, more about the data work, warmer opening" onKeyDown={(e) => e.key === "Escape" && setRewrite(null)} />
            <button className="btn primary" type="submit" disabled={busy === "rewrite"}>{busy === "rewrite" ? <LoaderCircle className="spin-icon" /> : <WandSparkles />}Rewrite</button>
            <button className="icon-btn" type="button" onClick={() => setRewrite(null)} aria-label="Cancel"><X /></button>
          </form>
        )}
        {warned && item.status !== "approved" && (
          <div className="warn-bar" role="alert"><ShieldAlert />{counts.unsupported} claim{counts.unsupported > 1 ? "s are" : " is"} not backed by your CV (marked red). Edit {counts.unsupported > 1 ? "them" : "it"}, rewrite, or approve anyway.</div>
        )}
        <div className="review-foot">
          {item.hasPdf && <a className="file" href={`/api/file?app=${item.appId}`} target="_blank" rel="noreferrer"><FileText />Application PDF</a>}
          <div className="grow" />
          {item.status === "approved" ? (
            <>
              <span className="faint" style={{ fontSize: 13 }}>Approved – sent it?</span>
              {item.channel === "email" && <button className="btn ghost" onClick={() => act("openMail", { jobId: item.jobId }).then(() => toast("Mail draft opened"))}><Mail />Mail draft</button>}
              {item.channel === "form" && <button className="btn ghost" onClick={() => act("openForm", { jobId: item.jobId }).then(() => toast("Form opened"))}><MousePointerClick />Form</button>}
              <button className="btn primary" onClick={markSent} disabled={busy === "sent"}><Send />Mark as sent <kbd>⌘↵</kbd></button>
            </>
          ) : (
            <>
              <button className="btn ghost" onClick={() => setRewrite("")}><WandSparkles />Rewrite <kbd>R</kbd></button>
              <button className="btn primary" onClick={approve} disabled={busy === "approve"} title={item.channel === "email" ? "Approve and open an Apple Mail draft" : "Approve and open the application form"}>
                {busy === "approve" ? <LoaderCircle className="spin-icon" /> : <Check />}{warned ? "Approve anyway" : "Approve"} <kbd>⌘↵</kbd>
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
