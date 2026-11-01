import { get, getSettings, logEvent, run } from "@/lib/db";
import { claude, renderPrompt } from "@/lib/claude/runner";
import { FollowUp, PrepPack } from "@/lib/claude/schemas";
import { getJob } from "@/lib/jobs";
import { cvFacts, factBase } from "@/lib/profile";
import { truncate } from "@/lib/text";
import { ensureCompanyBrief, latestApplication } from "./drafting";

export async function prepPack(jobId: number) {
  const job = getJob(jobId);
  if (!job) return;
  const brief = await ensureCompanyBrief(jobId);
  const app = latestApplication(jobId);
  const de = job.language !== "en";
  const res = await claude({
    name: "prep-pack", model: "opus", schema: PrepPack, timeoutMs: 360_000,
    prompt: renderPrompt("prep-pack", { language_name: de ? "German" : "English", note: job.next_action ?? "(no details yet)", facts: factBase(), brief, ad: truncate(job.description, 8000), letter: app?.letter ?? "(none)" }),
    mockInput: { job, facts: cvFacts()?.facts ?? [] },
  });
  run("INSERT INTO prep_packs(job_id, markdown) VALUES (?, ?) ON CONFLICT(job_id) DO UPDATE SET markdown = excluded.markdown, created_at = datetime('now')", [jobId, res.markdown]);
  logEvent(jobId, "prep", "Interview prep pack ready");
}

export function getPrepPack(jobId: number) {
  return get<{ markdown: string; created_at: string }>("SELECT markdown, created_at FROM prep_packs WHERE job_id = ?", [jobId]);
}

export async function followUpDraft(jobId: number) {
  const job = getJob(jobId);
  const app = latestApplication(jobId);
  if (!job || !app) return;
  const days = Math.round((Date.now() - Date.parse((app.sent_at ?? job.stage_changed_at) + "Z")) / 86_400_000);
  const de = job.language !== "en";
  const s = getSettings();
  const res = await claude({
    name: "follow-up", model: "sonnet", schema: FollowUp,
    prompt: renderPrompt("follow-up", { days, language_name: de ? "German" : "English", name: s.name, title: job.title, company: job.company, sent: (app.sent_at ?? "").slice(0, 10), subject: app.subject }),
    mockInput: { job, days, language: de ? "de" : "en", name: s.name },
  });
  run("UPDATE jobs SET next_action = ?, next_action_at = datetime('now') WHERE id = ?", [`Follow up · ${res.subject}`, jobId]);
  run("INSERT INTO events(job_id, type, text) VALUES (?, 'followup', ?)", [jobId, JSON.stringify(res)]);
}
