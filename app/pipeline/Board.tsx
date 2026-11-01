"use client";

import { Calendar, Clock, Ghost, LoaderCircle, PenLine, Star, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { act, openJob, toast } from "@/lib/client";
import { scoreColor } from "@/lib/ui";
import { Tile } from "../_components/ui";

export type BoardCard = { id: number; title: string; company: string; stage: string; col: string; sub: string | null; score: number | null; days: number; dream: boolean; note: string | null; ghost: boolean };

const DOT: Record<string, string> = { prep: "var(--info)", applied: "var(--text-2)", contact: "var(--ok)", round1: "var(--accent-fg)", final: "var(--danger)" };

export function Board({ cards, columns, closed }: { cards: BoardCard[]; columns: { key: string; name: string }[]; closed: number }) {
  const router = useRouter();
  const [local, setLocal] = useState<Record<number, string>>({});
  const [over, setOver] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const colOf = (c: BoardCard) => local[c.id] ?? c.col;

  const move = async (c: BoardCard, to: string) => {
    if (colOf(c) === to) return;
    const from = colOf(c);
    setLocal((l) => ({ ...l, [c.id]: to }));
    try {
      const r = await act<{ prev: string }>("move", { jobId: c.id, to });
      const name = columns.find((x) => x.key === to)?.name;
      toast(`${c.company} → ${name}${to === "round1" ? " · creating prep pack" : to === "prep" ? " · Claude will draft" : ""}`, async () => {
        await act("move", { jobId: c.id, to: r.prev });
        setLocal((l) => ({ ...l, [c.id]: from }));
        router.refresh();
      });
      router.refresh();
    } catch (e) {
      setLocal((l) => ({ ...l, [c.id]: from }));
      toast((e as Error).message, undefined, "error");
    }
  };

  return (
    <div className="board-wrap">
      <div className="board">
        {columns.map((col, ci) => {
          const cs = cards.filter((c) => colOf(c) === col.key);
          return (
            <section
              key={col.key}
              className={`col${over === col.key ? " over" : ""}`}
              aria-label={col.name}
              onDragOver={(e) => { e.preventDefault(); setOver(col.key); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const c = cards.find((x) => x.id === drag);
                if (c) void move(c, col.key);
              }}
            >
              <div className="col-h"><span className="dot" style={{ background: DOT[col.key] }} />{col.name}<span className="badge">{cs.length}</span></div>
              {cs.length === 0 && <div className="col-empty">{ci === 0 ? "Apply to jobs in Discover" : "Drag cards here"}</div>}
              {cs.map((c) => (
                <article
                  key={c.id}
                  className={`card kcard${drag === c.id ? " dragging" : ""}`}
                  draggable
                  tabIndex={0}
                  aria-label={`${c.title}, ${c.company}. Press [ or ] to move.`}
                  onDragStart={(e) => { setDrag(c.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => setDrag(null)}
                  onClick={() => openJob(c.id)}
                  onKeyDown={(e) => {
                    const i = columns.findIndex((x) => x.key === colOf(c));
                    if (e.key === "Enter") openJob(c.id);
                    if (e.key === "]" && i < columns.length - 1) void move(c, columns[i + 1].key);
                    if (e.key === "[" && i > 0) void move(c, columns[i - 1].key);
                  }}
                >
                  <div className="row"><Tile name={c.company} small /><div style={{ minWidth: 0, flex: 1 }}><div className="t">{c.title}</div><div className="c">{c.company}</div></div></div>
                  <div className="foot">
                    {c.dream && <span className="tag warn"><Star />Dream</span>}
                    {colOf(c) === "prep" && c.sub === "queued" && <span className="tag"><Clock />Waiting for draft</span>}
                    {colOf(c) === "prep" && c.sub === "drafting" && <span className="tag info"><LoaderCircle className="spin-icon" />Claude writing</span>}
                    {colOf(c) === "prep" && c.sub === "ready" && <Link className="tag warn" href={`/review?job=${c.id}`} onClick={(e) => e.stopPropagation()}><PenLine />Ready to review</Link>}
                    {colOf(c) === "prep" && (c.sub === "blocked" || c.sub === "failed") && <span className="tag bad" title={c.note ?? ""}><TriangleAlert />{c.sub === "blocked" ? "Needs CV" : "Draft failed"}</span>}
                    {c.ghost && colOf(c) === "applied" && <span className="tag bad"><Ghost />Follow up?</span>}
                    {c.note && !["prep"].includes(colOf(c)) && !c.ghost && <span className="tag accent" title={c.note}><Calendar />{c.note.length > 26 ? c.note.slice(0, 25) + "…" : c.note}</span>}
                    {c.score != null && <span className="tag mono" style={{ color: scoreColor(c.score) }}>{c.score}</span>}
                    <span className="age">{c.days === 0 ? "today" : `${c.days} d`}</span>
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
      {closed > 0 && <p className="faint" style={{ fontSize: 12, marginTop: 14 }}>{closed} closed in the last 30 days (rejected, ghosted, withdrawn) – see Insights.</p>}
    </div>
  );
}
