"use client";

import { Banknote, Check, ExternalLink, Hand, House, Languages, MapPin, Minus, PenLine, Send, Star, StickyNote, ThumbsDown, ThumbsUp, TriangleAlert, X, Eye } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { act, openJob, toast } from "@/lib/client";
import { Ring, Tile } from "../_components/ui";

export type Card = {
  id: number; title: string; company: string; location: string; remote: string; salary: string; language: string; score: number; age: string; source: string;
  dream: boolean; manual: boolean; note: string | null; watchlist: boolean; url: string | null; reasonsFor: string[]; reasonsAgainst: string[]; flags: string[];
  dims: Record<string, number> | null; excerpt: string;
};

const REASONS = ["Too junior", "Too senior", "Wrong industry", "Agency / consultancy", "Commute", "Salary", "Recruiter", "Not my role"];
const DIMS: [string, string][] = [["skills", "Skills"], ["seniority", "Seniority"], ["domain", "Domain"], ["location", "Location"], ["conditions", "Terms"]];

export function DiscoverClient({ cards, later }: { cards: Card[]; later: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState<Set<number>>(new Set());
  const [dreams, setDreams] = useState<Record<number, boolean>>({});
  const [selId, setSelId] = useState<number | null>(null);
  const [out, setOut] = useState<"out-right" | "out-left" | "out-up" | null>(null);
  const [reasons, setReasons] = useState(false);
  const [sessionDone, setSessionDone] = useState(0);

  const queue = useMemo(() => cards.filter((c) => !done.has(c.id)), [cards, done]);
  const sel = queue.find((c) => c.id === selId) ?? queue[0] ?? null;
  const total = sessionDone + queue.length;

  useEffect(() => setReasons(false), [sel?.id]);

  const advance = useCallback((id: number) => {
    const i = queue.findIndex((c) => c.id === id);
    const next = queue[i + 1] ?? queue[i - 1] ?? null;
    setSelId(next?.id ?? null);
  }, [queue]);

  const decide = useCallback(async (kind: "apply" | "reject" | "skip", reason?: string) => {
    if (!sel || out) return;
    const card = sel;
    const anim = kind === "apply" ? "out-right" : kind === "reject" ? "out-left" : "out-up";
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setOut(anim);
    setTimeout(() => {
      setOut(null);
      setDone((d) => new Set(d).add(card.id));
      setSessionDone((n) => n + 1);
      advance(card.id);
    }, reduce ? 0 : 260);
    try {
      const r = await act<{ prev: { stage: string } }>("decide", { jobId: card.id, kind, reason });
      const msg = kind === "apply" ? `Shortlisted: ${card.company}. Claude is writing the draft.` : kind === "reject" ? `Rejected${reason ? `: ${reason}` : ""} – noted for learning` : "Saved for later";
      toast(msg, async () => {
        await act("undo", { jobId: card.id, stage: r.prev.stage });
        setDone((d) => { const n = new Set(d); n.delete(card.id); return n; });
        setSessionDone((n) => Math.max(0, n - 1));
        setSelId(card.id);
        router.refresh();
      });
    } catch (e) {
      toast((e as Error).message, undefined, "error");
      setDone((d) => { const n = new Set(d); n.delete(card.id); return n; });
    }
  }, [sel, out, advance, router]);

  const toggleDream = useCallback(async () => {
    if (!sel) return;
    const on = !(dreams[sel.id] ?? sel.dream);
    setDreams((d) => ({ ...d, [sel.id]: on }));
    try {
      await act("decide", { jobId: sel.id, kind: on ? "dream" : "undream" });
      toast(on ? "Marked as dream job – counts 3× for learning" : "Dream job removed");
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    }
  }, [sel, dreams]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".palette.show, .drawer.show")) return;
      const k = e.key.toLowerCase();
      if (reasons && /^[1-8]$/.test(k)) return void decide("reject", REASONS[Number(k) - 1]);
      if (k === "a") void decide("apply");
      else if (k === "x") setReasons(true);
      else if (k === "s") void decide("skip");
      else if (k === "d") void toggleDream();
      else if (k === "o" && sel?.url) window.open(sel.url, "_blank", "noopener");
      else if (k === "enter" && sel) openJob(sel.id);
      else if ((k === "j" || k === "k" || k === "arrowdown" || k === "arrowup") && sel) {
        e.preventDefault();
        const i = queue.findIndex((c) => c.id === sel.id);
        const n = queue[Math.max(0, Math.min(queue.length - 1, i + (k === "j" || k === "arrowdown" ? 1 : -1)))];
        if (n) setSelId(n.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, toggleDream, reasons, sel, queue]);

  const dream = sel ? dreams[sel.id] ?? sel.dream : false;

  return (
    <div className="discover">
      <aside className="queue" aria-label="Queue">
        <div className="queue-h"><span>Queue · <span className="mono">{queue.length}</span></span><span className="tag">Score ↓</span></div>
        <div role="listbox" aria-label="Jobs">
          {queue.map((q) => (
            <div key={q.id} className="q-item" role="option" aria-selected={q.id === sel?.id} tabIndex={-1} onClick={() => setSelId(q.id)}>
              <Tile name={q.company} small />
              <div className="grow"><div className="t">{(dreams[q.id] ?? q.dream) ? "★ " : ""}{q.title}</div><div className="c">{q.company} · {q.location}</div></div>
              <Ring score={q.score} size={30} stroke={3} />
            </div>
          ))}
        </div>
      </aside>
      <section className="stage">
        <div className="session" aria-label="Progress">
          <span><b className="mono">{sessionDone}</b> of <span className="mono">{total}</span> reviewed</span>
          <div className="meter"><i style={{ width: `${total ? (sessionDone / total) * 100 : 0}%` }} /></div>
          <span className="faint mono">{queue.length ? `≈ ${Math.max(1, Math.round((queue.length * 20) / 60))} min` : "done"}</span>
        </div>
        {sel ? (
          <article key={sel.id} className={`card tcard ${out ?? "in"}`}>
            <div className="tcard-top">
              <Tile name={sel.company} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="co">
                  {sel.manual && <span className="tag accent" style={{ height: 20 }}><Hand />Manual</span>}
                  {sel.watchlist && <span className="tag accent" style={{ height: 20 }}><Eye />Watchlist</span>}
                  <span>{sel.company}</span><span className="faint">·</span><span className="faint">{sel.age}</span>{sel.source && <><span className="faint">·</span><span className="faint">{sel.source}</span></>}
                </div>
                <h2>{sel.title}</h2>
              </div>
              <div style={{ textAlign: "center" }}><Ring score={sel.score} size={76} stroke={5} /><div className="faint" style={{ fontSize: 11, marginTop: 4 }}>Match</div></div>
            </div>
            <div className="facts">
              <span className="tag"><MapPin />{sel.location}</span><span className="tag"><House />{sel.remote}</span>
              <span className="tag"><Banknote /><span className="mono">{sel.salary}</span></span><span className="tag"><Languages />{sel.language}</span>
              {sel.note && <span className="tag info"><StickyNote />{sel.note}</span>}
              {sel.flags.map((f) => <span key={f} className="tag warn"><TriangleAlert />{f}</span>)}
            </div>
            <div className="why">
              <div className="why-col"><h3><ThumbsUp />In favor</h3><ul>{sel.reasonsFor.map((x) => <li key={x}><Check style={{ color: "var(--ok)" }} />{x}</li>)}</ul></div>
              <div className="why-col"><h3><ThumbsDown />Against</h3><ul>{sel.reasonsAgainst.length ? sel.reasonsAgainst.map((x) => <li key={x}><Minus style={{ color: "var(--dream)" }} />{x}</li>) : <li className="faint">Nothing notable</li>}</ul></div>
            </div>
            {sel.dims && (
              <div className="dims">
                {DIMS.map(([k, label]) => (
                  <div className="dim" key={k}><b>{sel.dims![k] ?? "–"}</b><div className="meter"><i style={{ width: `${sel.dims![k] ?? 0}%` }} /></div><div style={{ marginTop: 6 }}>{label}</div></div>
                ))}
              </div>
            )}
            <p className="excerpt">{sel.excerpt}{sel.excerpt.length >= 420 ? "…" : ""} <button className="link" onClick={() => openJob(sel.id)}>Full ad</button></p>
            <div className="actions">
              <button className="btn primary" onClick={() => void decide("apply")}><Send />Apply <kbd>A</kbd></button>
              <button className={`btn dream${dream ? " on" : ""}`} aria-pressed={dream} onClick={() => void toggleDream()}><Star />Dream job <kbd>D</kbd></button>
              <button className="btn reject" onClick={() => setReasons(true)}><X />Reject <kbd>X</kbd></button>
              {!later && <button className="btn ghost" onClick={() => void decide("skip")}>Later <kbd>S</kbd></button>}
              {sel.url && <a className="btn ghost" style={{ marginLeft: "auto" }} href={sel.url} target="_blank" rel="noreferrer"><ExternalLink />View ad <kbd>O</kbd></a>}
            </div>
            <div className={`reasons${reasons ? " show" : ""}`}>
              <p>Why not? Kompass learns from this for tomorrow.</p>
              <div className="chips">
                {REASONS.map((r, i) => <button key={r} className="chip" onClick={() => void decide("reject", r)}><kbd>{i + 1}</kbd>{r}</button>)}
                <button className="chip" onClick={() => void decide("reject")}>Just no</button>
              </div>
            </div>
          </article>
        ) : (
          <div className="all-done enter">
            <div className="serif">All caught up.</div>
            <p className="muted">{later ? "Nothing saved for later." : "New ads are fetched every 3 hours. Kompass will let you know."}</p>
            <Link className="btn" href="/review"><PenLine />Go to drafts</Link>
          </div>
        )}
      </section>
    </div>
  );
}
