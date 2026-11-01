import { get } from "@/lib/db";
import { BOARD, jobsInStages } from "@/lib/jobs";
import { daysSince } from "@/lib/ui";
import { Board, type BoardCard } from "./Board";

export const dynamic = "force-dynamic";

export default function Pipeline() {
  const stages = BOARD.flatMap((b) => [...b.stages]);
  const cards: BoardCard[] = jobsInStages(stages, "j.dream DESC, j.stage_changed_at DESC").map((j) => ({
    id: j.id, title: j.title, company: j.company, stage: j.stage, col: BOARD.find((b) => (b.stages as readonly string[]).includes(j.stage))!.key,
    sub: j.stage === "drafting" ? "drafting" : j.stage === "review" ? "ready" : j.prep_sub === "blocked" ? "blocked" : j.stage === "shortlist" ? (j.next_action?.startsWith("Draft failed") ? "failed" : "queued") : null,
    score: j.score, days: daysSince(j.stage_changed_at), dream: !!j.dream, note: j.next_action,
    ghost: j.stage === "applied" && daysSince(j.stage_changed_at) >= 14,
  }));
  const closed = get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'closed' AND stage_changed_at > datetime('now','-30 days') AND closed_reason NOT LIKE 'not interested%'")!.n;
  return <Board cards={cards} columns={BOARD.map((b) => ({ key: b.key, name: b.name }))} closed={closed} />;
}
