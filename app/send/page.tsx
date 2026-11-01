import Link from "next/link";
import { PenLine } from "lucide-react";
import { all, getSettings } from "@/lib/db";
import { JOB_SELECT, type JobRow } from "@/lib/jobs";
import { applicationView, latestApplication } from "@/lib/pipeline/drafting";
import { SendClient, type SendItem } from "./SendClient";

export const dynamic = "force-dynamic";

export default async function SendPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const want = Number((await searchParams).job) || null;
  const jobs = all<JobRow>(`${JOB_SELECT} WHERE j.stage = 'ready' ORDER BY j.dream DESC, j.stage_changed_at`);
  const items: SendItem[] = jobs.flatMap((j) => {
    const a = latestApplication(j.id);
    if (!a) return [];
    const v = applicationView(a);
    return [{
      jobId: j.id, appId: a.id, title: j.title, company: j.company, location: j.location, dream: !!j.dream, language: a.language,
      url: j.url, applyEmail: j.apply_email, subject: a.subject, letter: a.letter, emailBody: a.email_body, answers: v.answers,
      approvedAt: a.approved_at, hasPdf: !!a.bundle_path, bundleName: a.bundle_path?.split("/").pop() ?? null,
    }];
  });
  if (!items.length) {
    const review = all<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'review'")[0].n;
    return (
      <div className="all-done enter">
        <div className="serif">Nothing waiting to be sent.</div>
        <p className="muted">{review ? `${review} draft${review > 1 ? "s are" : " is"} waiting for your review. Approved applications land here.` : "Approved applications land here, ready to send by email or through the company's form."}</p>
        {review > 0 && <Link className="btn" href="/review"><PenLine />Go to Review</Link>}
      </div>
    );
  }
  const s = getSettings();
  return <SendClient items={items} initialJob={want} me={{ name: s.name, email: s.email, phone: s.phone, salary: s.salaryExpectation, start: s.earliestStart, notice: s.noticePeriod }} />;
}
