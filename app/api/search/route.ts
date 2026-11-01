import { NextResponse } from "next/server";
import { all } from "@/lib/db";
import { stageLabel } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ jobs: [] });
  const like = `%${q}%`;
  const jobs = all<{ id: number; title: string; company: string; stage: string; score: number | null }>(
    `SELECT j.id, j.title, c.name AS company, j.stage, j.score FROM jobs j JOIN companies c ON c.id = j.company_id
     WHERE (lower(j.title) LIKE ? OR lower(c.name) LIKE ?) AND j.stage != 'excluded' ORDER BY j.found_at DESC LIMIT 12`,
    [like, like],
  ).map((j) => ({ ...j, stageLabel: stageLabel(j.stage) }));
  return NextResponse.json({ jobs });
}
