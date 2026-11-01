import Link from "next/link";
import { all, getSettings } from "@/lib/db";
import { JOB_SELECT, type JobRow } from "@/lib/jobs";
import { applicationView, latestApplication } from "@/lib/pipeline/drafting";
import { PenLine } from "lucide-react";
import { ReviewClient, type ReviewItem } from "./ReviewClient";

export const dynamic = "force-dynamic";

export default async function Review({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const want = Number((await searchParams).job) || null;
  const jobs = all<JobRow>(`${JOB_SELECT} WHERE j.stage = 'review' ORDER BY j.dream DESC, j.score DESC`);
  const drafting = all<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE stage IN ('shortlist','drafting')")[0].n;
  const items: ReviewItem[] = jobs.flatMap((j) => {
    const a = latestApplication(j.id);
    if (!a) return [];
    const v = applicationView(a);
    return [{
      jobId: j.id, appId: a.id, title: j.title, company: j.company, location: j.location, dream: !!j.dream, language: a.language, url: j.url,
      channel: j.apply_email ? "email" : j.url ? "form" : "none", applyEmail: j.apply_email, version: a.version, subject: a.subject, letter: a.letter,
      emailBody: a.email_body, status: a.status, coverage: v.coverage, claims: v.factcheck.claims, answers: v.answers, hasPdf: !!a.bundle_path, createdAt: a.created_at,
    }];
  });
  if (!items.length) {
    return (
      <div className="all-done enter">
        <div className="serif">No drafts to review.</div>
        <p className="muted">{drafting ? `Claude is working on ${drafting} application${drafting > 1 ? "s" : ""}. They show up here when ready.` : "Apply to jobs in Discover and Claude writes the drafts."}</p>
        <Link className="btn" href="/discover"><PenLine />Go to Discover</Link>
      </div>
    );
  }
  const s = getSettings();
  return <ReviewClient items={items} initialJob={want} profile={{ salary: s.salaryExpectation, start: s.earliestStart, notice: s.noticePeriod }} />;
}
