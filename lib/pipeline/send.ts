import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getSettings, logEvent } from "@/lib/db";
import { getJob } from "@/lib/jobs";
import { latestApplication } from "./drafting";

const as = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, '" & return & "')}"`;

export function mailScript(o: { to: string; subject: string; body: string; attachments: string[] }) {
  return [
    'tell application "Mail"',
    `  set m to make new outgoing message with properties {subject:${as(o.subject)}, content:${as(o.body + "\n\n")}, visible:true}`,
    "  tell m",
    `    make new to recipient at end of to recipients with properties {address:${as(o.to)}}`,
    ...o.attachments.map((a) => `    make new attachment with properties {file name:(POSIX file ${as(a)})} at after the last paragraph`),
    "  end tell",
    "  activate",
    "end tell",
  ].join("\n");
}

/** Opens a ready-to-send Apple Mail draft. The job seeker presses Send. */
export function openMailDraft(jobId: number): { ok: boolean; message: string } {
  const job = getJob(jobId);
  const app = latestApplication(jobId);
  if (!job || !app?.bundle_path) return { ok: false, message: "No approved application with a PDF yet" };
  if (!job.apply_email) return { ok: false, message: "This ad has no application email address" };
  if (process.env.KOMPASS_DRY_SEND) return { ok: true, message: `dry run: mail to ${job.apply_email}` };
  const r = spawnSync("osascript", ["-e", mailScript({ to: job.apply_email, subject: app.subject, body: app.email_body, attachments: [app.bundle_path] })], { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) return { ok: false, message: `Apple Mail: ${(r.stderr || "failed").trim().slice(0, 200)}` };
  logEvent(jobId, "mail", `Mail draft opened for ${job.apply_email}`);
  return { ok: true, message: `Draft to ${job.apply_email} is open in Apple Mail` };
}

/** Opens the apply page in a visible browser and fills the obvious fields. Stops before submit. */
export async function openApplyForm(jobId: number): Promise<{ ok: boolean; message: string; filled: string[] }> {
  const job = getJob(jobId);
  const app = latestApplication(jobId);
  if (!job?.url) return { ok: false, message: "No application link for this job", filled: [] };
  const s = getSettings();
  const [first, ...rest] = s.name.split(" ");
  const fields: [RegExp, string][] = [
    [/first.?name|vorname|given/i, first ?? ""],
    [/last.?name|nachname|surname|family/i, rest.join(" ")],
    [/^name$|full.?name|ihr name/i, s.name],
    [/e-?mail/i, s.email],
    [/phone|telefon|mobil/i, s.phone],
    [/salary|gehalt/i, s.salaryExpectation],
    [/notice|kündigungsfrist/i, s.noticePeriod],
    [/start|eintritt|verfügbar|available/i, s.earliestStart],
  ];
  if (process.env.KOMPASS_DRY_SEND) return { ok: true, message: "dry run: the form would open in Chrome", filled: [] };
  const dir = app?.bundle_path ? path.dirname(app.bundle_path) : null;
  const part = (...names: string[]) => (dir ? names.map((n) => path.join(dir, n)).find((f) => fs.existsSync(f)) : undefined);
  const files = { bundle: app?.bundle_path ?? undefined, letter: part("Anschreiben.pdf", "Cover_letter.pdf"), cv: part("Lebenslauf.pdf", "CV.pdf") };
  const { chromium } = await import("playwright");
  // the job seeker's installed Chrome first; Playwright's Chromium if Chrome isn't there
  const browser = await chromium.launch({ headless: false, channel: "chrome" }).catch(() => chromium.launch({ headless: false }));
  const page = await browser.newPage();
  await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const filled: string[] = [];
  const uploaded = new Set<string>();
  for (const input of await page.locator("input, textarea").all()) {
    const meta = [await input.getAttribute("name"), await input.getAttribute("id"), await input.getAttribute("placeholder"), await input.getAttribute("aria-label"), await input.getAttribute("autocomplete")].filter(Boolean).join(" ");
    const type = (await input.getAttribute("type")) ?? "text";
    if (["hidden", "submit", "button", "checkbox", "radio", "password"].includes(type)) continue;
    if (type === "file") {
      // upload fields are often hidden behind a styled button, so they are not checked for visibility
      const want = /lebenslauf|\bcv\b|resume|curriculum/i.test(meta) ? "cv" : /anschreiben|cover|letter|motivation/i.test(meta) ? "letter" : "bundle";
      const file = files[want] ?? files.bundle;
      if (file && !uploaded.has(want)) {
        await input.setInputFiles(file).then(() => { uploaded.add(want); filled.push(want === "bundle" ? "documents" : want); }).catch(() => {});
      }
      continue;
    }
    if (!(await input.isVisible().catch(() => false))) continue;
    const isText = (await input.evaluate((el) => el.tagName)) === "TEXTAREA";
    const hit = isText && /anschreiben|cover|letter|motivation|message|nachricht/i.test(meta) ? app?.letter : fields.find(([re, v]) => v && re.test(meta))?.[1];
    if (hit && !(await input.inputValue().catch(() => ""))) {
      await input.fill(hit).catch(() => {});
      filled.push(meta.split(" ")[0] || "field");
    }
  }
  logEvent(jobId, "form", `Application form opened, ${filled.length} field(s) pre-filled`);
  // Browser stays open for the job seeker to check and submit.
  return { ok: true, message: filled.length ? `Pre-filled ${filled.length} field(s). Check everything, then submit yourself.` : "Form opened. Fill it in and submit yourself.", filled };
}
