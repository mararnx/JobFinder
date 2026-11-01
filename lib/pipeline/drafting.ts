import { get, getSettings, json, logEvent, run } from "@/lib/db";
import { claude, renderPrompt } from "@/lib/claude/runner";
import { CompanyBrief, Draft, FactCheck } from "@/lib/claude/schemas";
import { getJob, setStage } from "@/lib/jobs";
import { cvFacts, factBase, styleGuide } from "@/lib/profile";
import { fetchText } from "@/lib/sources/http";
import { stripHtml, truncate } from "@/lib/text";
import { buildBundle } from "./pdf";

const JOB_BOARDS = /arbeitsagentur|stepstone|indeed|xing|linkedin|greenhouse|lever\.co|personio|smartrecruiters|recruitee|workday|softgarden|join\.com|germantechjobs|glassdoor|monster/i;

const DEFAULT_BANNED = ["Hiermit bewerbe ich mich", "mit großem Interesse", "I am excited to apply", "passionate", "dynamic team"];

function companySite(companyId: number, jobUrl: string | null): string | null {
  const c = get<{ domain: string | null }>("SELECT domain FROM companies WHERE id = ?", [companyId]);
  if (c?.domain) return c.domain.startsWith("http") ? c.domain : `https://${c.domain}`;
  if (jobUrl) {
    try {
      const u = new URL(jobUrl);
      if (!JOB_BOARDS.test(u.hostname)) return `${u.protocol}//${u.hostname.replace(/^(karriere|jobs|careers|career)\./, "www.")}`;
    } catch { /* ignore */ }
  }
  return null;
}

/** Short company research, cached per company for 30 days. */
export async function ensureCompanyBrief(jobId: number): Promise<string> {
  const job = getJob(jobId);
  if (!job) throw new Error("job not found");
  const c = get<{ brief_md: string | null; brief_at: string | null }>("SELECT brief_md, brief_at FROM companies WHERE id = ?", [job.company_id])!;
  if (c.brief_md && c.brief_at && Date.now() - Date.parse(c.brief_at + "Z") < 30 * 86_400_000) return c.brief_md;
  const site = companySite(job.company_id, job.url);
  const pages: string[] = [];
  if (site) {
    for (const p of ["", "/ueber-uns", "/about", "/about-us", "/unternehmen"]) {
      try {
        const r = await fetchText(site + p, { timeoutMs: 12_000 });
        if (r.status === 200) pages.push(`<page url="${r.finalUrl}">\n${truncate(stripHtml(r.text), 4000)}\n</page>`);
      } catch { /* site unreachable */ }
      if (pages.length >= 3) break;
    }
  }
  const material = [...pages, `<job_ad>\n${truncate(job.description, 4000)}\n</job_ad>`].join("\n\n");
  const res = await claude({ name: "company-brief", model: "sonnet", schema: CompanyBrief, prompt: renderPrompt("company-brief", { company: job.company, material }), mockInput: { company: job.company, material: pages[0] ?? job.description.slice(0, 400) } });
  run("UPDATE companies SET brief_md = ?, brief_at = datetime('now') WHERE id = ?", [res.markdown, job.company_id]);
  return res.markdown;
}

function contactPerson(text: string): string | null {
  const m = text.match(/(?:Ansprechpartner(?:in)?|Ihr(?:e)? Kontakt|Kontakt|Contact person|Your contact)[:\s]+((?:Frau|Herr|Ms\.?|Mr\.?|Mrs\.?)\s+[A-ZÄÖÜ][\wäöüß-]+(?:\s+[A-ZÄÖÜ][\wäöüß-]+)?)/);
  return m ? m[1].trim() : null;
}

/** Writes (or rewrites) the application for a job, fact-checks it and builds the PDF bundle. */
export async function draftApplication(jobId: number, instruction?: string) {
  const job = getJob(jobId);
  if (!job) throw new Error("job not found");
  if (!instruction && !["shortlist", "drafting"].includes(job.stage)) return latestApplication(jobId)?.id ?? null; // duplicate task
  if (!cvFacts()) {
    run("UPDATE jobs SET stage = 'shortlist', prep_sub = 'blocked', next_action = 'Upload your CV in Documents first' WHERE id = ?", [jobId]);
    throw new Error("No CV parsed yet – upload a CV in Documents");
  }
  const s = getSettings();
  run("UPDATE jobs SET stage = 'drafting', prep_sub = 'drafting', stage_changed_at = datetime('now') WHERE id = ?", [jobId]);
  const brief = await ensureCompanyBrief(jobId);
  const language = (job.language === "en" ? "en" : "de") as "de" | "en";
  const style = styleGuide();
  const facts = factBase();
  const prev = get<{ letter: string; version: number }>("SELECT letter, version FROM applications WHERE job_id = ? ORDER BY version DESC LIMIT 1", [jobId]);
  const instr = instruction
    ? `- Revision request from the applicant: "${instruction}". Apply it to this previous version:\n<previous>\n${prev?.letter ?? ""}\n</previous>`
    : "";
  const contact = contactPerson(job.description);
  const draft = await claude({
    name: "draft",
    model: "opus",
    schema: Draft,
    timeoutMs: 360_000,
    prompt: renderPrompt("draft", {
      language_name: language === "de" ? "German" : "English",
      banned: (style?.banned_phrases ?? DEFAULT_BANNED).map((p) => `"${p}"`).join(", "),
      instruction: instr,
      name: s.name || "(name missing – leave a placeholder)",
      contact: [s.email, s.phone, s.address].filter(Boolean).join(" · ") || "n/a",
      salary: s.salaryExpectation || "not stated",
      notice: s.noticePeriod || "not stated",
      start: s.earliestStart || "by arrangement",
      facts,
      style: style?.markdown ?? "(no style guide yet – write plainly and concretely)",
      brief,
      title: job.title,
      company: job.company,
      ad: truncate(job.description, 9000),
    }),
    mockInput: {
      job: { ...job, contact }, language, name: s.name, salary: s.salaryExpectation, start: s.earliestStart, notice: s.noticePeriod,
      facts: cvFacts()?.facts ?? [],
    },
  });
  const check = await claude({
    name: "factcheck",
    model: "sonnet",
    schema: FactCheck,
    prompt: renderPrompt("factcheck", { facts, letter: draft.letter }),
    mockInput: { letter: draft.letter, facts: cvFacts()?.facts ?? [] },
  });
  const version = (prev?.version ?? 0) + 1;
  const appId = run(
    `INSERT INTO applications(job_id, version, language, subject, letter, email_body, cv_json, answers_json, factcheck_json, coverage_json, instruction, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [jobId, version, draft.language, draft.subject, draft.letter, draft.email_body, JSON.stringify(draft.cv_tailoring), JSON.stringify({ ...draft.answers, recipient: draft.recipient_name ?? contact }),
      JSON.stringify(check), JSON.stringify(draft.coverage), instruction ?? null, job.apply_email ? "email" : job.apply_channel ?? "portal"],
  ).lastInsertRowid;
  await buildBundle(appId);
  run("UPDATE applications SET status = 'superseded' WHERE job_id = ? AND id != ? AND status = 'draft'", [jobId, appId]);
  run("UPDATE jobs SET stage = 'review', prep_sub = 'ready', stage_changed_at = datetime('now'), next_action = NULL WHERE id = ?", [jobId]);
  const unsupported = check.claims.filter((c) => c.status === "unsupported").length;
  logEvent(jobId, "draft", `Claude: application v${version}${instruction ? ` (“${truncate(instruction, 40)}”)` : ""}${unsupported ? ` · ${unsupported} unsupported claim(s)` : ""}`);
  return appId;
}

export type AppRow = {
  id: number; job_id: number; version: number; language: string; subject: string; letter: string; email_body: string;
  cv_json: string; answers_json: string; factcheck_json: string; coverage_json: string; bundle_path: string | null;
  status: string; created_at: string; approved_at: string | null; sent_at: string | null; channel: string | null; review_seconds: number | null;
};

export function latestApplication(jobId: number): AppRow | undefined {
  return get<AppRow>("SELECT * FROM applications WHERE job_id = ? AND status != 'superseded' ORDER BY version DESC LIMIT 1", [jobId]);
}

export function applicationView(a: AppRow) {
  return {
    ...a,
    cv: json<{ summary: string; skill_order: string[]; highlight_fact_ids: string[] }>(a.cv_json, { summary: "", skill_order: [], highlight_fact_ids: [] }),
    answers: json<{ salary: string; start_date: string; notice_period: string; why_us: string; recipient?: string | null }>(a.answers_json, { salary: "", start_date: "", notice_period: "", why_us: "" }),
    factcheck: json<FactCheck>(a.factcheck_json, { claims: [] }),
    coverage: json<{ requirement: string; status: "covered" | "partial" | "missing"; where: string }[]>(a.coverage_json, []),
  };
}

/** Saves edits from the Review screen and rebuilds the PDF. */
export async function saveLetterEdit(appId: number, letter: string, subject?: string) {
  run("UPDATE applications SET letter = ?, subject = COALESCE(?, subject) WHERE id = ?", [letter, subject ?? null, appId]);
  await buildBundle(appId);
}

export function approve(appId: number, reviewSeconds: number) {
  const a = get<{ job_id: number }>("SELECT job_id FROM applications WHERE id = ?", [appId]);
  if (!a) throw new Error("application not found");
  run("UPDATE applications SET status = 'approved', approved_at = datetime('now'), review_seconds = ? WHERE id = ?", [Math.round(reviewSeconds), appId]);
  logEvent(a.job_id, "approved", `Draft approved · ${Math.round(reviewSeconds)} s review`);
  return a.job_id;
}

export function markSent(jobId: number) {
  const a = latestApplication(jobId);
  if (a) run("UPDATE applications SET status = 'sent', sent_at = datetime('now') WHERE id = ?", [a.id]);
  setStage(jobId, "applied");
  run("UPDATE jobs SET prep_sub = NULL WHERE id = ?", [jobId]);
}
