import { NextResponse } from "next/server";
import { all, get, json } from "@/lib/db";
import { getJob } from "@/lib/jobs";
import { applicationView, latestApplication } from "@/lib/pipeline/drafting";
import { getPrepPack } from "@/lib/pipeline/prep";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("id"));
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const app = latestApplication(id);
  const company = get<{ brief_md: string | null; watchlist: number; blocked: number }>("SELECT brief_md, watchlist, blocked FROM companies WHERE id = ?", [job.company_id]);
  const postings = all<{ source: string; url: string | null }>("SELECT source, url FROM postings WHERE job_id = ? ORDER BY id", [id]);
  const events = all<{ type: string; text: string; at: string }>("SELECT type, text, at FROM events WHERE job_id = ? ORDER BY id DESC LIMIT 40", [id]);
  const followUp = events.find((e) => e.type === "followup");
  return NextResponse.json({
    job: { ...job, score_json: json(job.score_json, null) },
    company,
    postings,
    events: events.filter((e) => e.type !== "followup"),
    application: app ? applicationView(app) : null,
    prep: getPrepPack(id) ?? null,
    followUp: followUp ? json<{ subject: string; body: string } | null>(followUp.text, null) : null,
  });
}
