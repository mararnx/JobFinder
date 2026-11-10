/**
 * End-to-end pipeline on an isolated database with mock Claude: ingest → filter → score → decide →
 * draft → fact-check → PDF → approve → sent → interview → prep pack → follow-up → learning.
 * No network: jobs are ingested directly, sources are not called.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kompass-e2e-"));
Object.assign(process.env, { KOMPASS_DATA: tmp, KOMPASS_CLAUDE: "mock", KOMPASS_MOCK_DELAY: "0", KOMPASS_NO_NOTIFY: "1", KOMPASS_DRY_SEND: "1" });

const { all, get, run, setSettings, getSettings } = await import("@/lib/db");
const { ingest, getJob } = await import("@/lib/jobs");
const { dispatch } = await import("@/lib/actions");
const { saveUpload } = await import("@/lib/pipeline/documents");
const { cvFacts, currentProfile, styleGuide } = await import("@/lib/profile");
const { drain, schedule } = await import("@/worker/index");
const { closePdfBrowser } = await import("@/lib/pipeline/pdf");
const { PDFDocument } = await import("pdf-lib");

const desc = (extra = "") => `Wir suchen dich als Product Owner für unsere B2B-Plattform. Deine Aufgaben:\n• Roadmap verantworten\n• Discovery mit Kunden\nDein Profil:\n• Erfahrung als Product Owner\n• SQL-Kenntnisse\n• Scrum\n${extra}`;

test.after(async () => {
  await closePdfBrowser();
});

test("setup: settings, search profile, documents", async () => {
  setSettings({ name: "Alex Neumann", email: "alex@example.com", phone: "+41 79 000 00 00", address: "Musterstrasse 1, 8004 Zürich", home: "Zürich", salaryFloor: 100000, salaryExpectation: "CHF 125'000", workload: "80–100 %", workPermit: "EU citizen, needs a B permit", noticePeriod: "3 months", earliestStart: "Feb 1, 2027", blockKeywords: ["Werkstudent"], excludeAgencies: true });
  run("INSERT INTO search_profiles(name, keywords, location, radius_km, enabled) VALUES ('Main', ?, 'Zürich', 30, 0)", [JSON.stringify(["Product Owner"])]); // disabled: no network in tests
  for (const f of fs.readdirSync("tests/fixtures/docs")) saveUpload(f, fs.readFileSync(path.join("tests/fixtures/docs", f)));
  await drain(60_000);
  const docs = all<{ kind: string; status: string; note: string }>("SELECT kind, status, note FROM documents ORDER BY kind");
  assert.deepEqual(docs.map((d) => [d.kind, d.status]), [["cv", "done"], ["letter", "done"], ["ref", "done"]]);
  assert.ok((cvFacts()?.facts.length ?? 0) >= 5, "CV facts extracted from the PDF");
  assert.match(docs.find((d) => d.kind === "ref")!.note, /sehr gut/, "German reference code decoded");
  assert.ok(styleGuide()?.banned_phrases.length, "style guide built from the letter");
});

test("onboarding creates the first preference profile", async () => {
  await dispatch("finishOnboarding", { liked: [{ text: "Senior Product Owner B2B SaaS\nRoadmap", reason: "product ownership" }], disliked: [{ text: "Werkstudent Vertrieb", reason: "too junior" }] });
  assert.equal(getSettings().onboarded, true);
  assert.equal(currentProfile()?.version, 1);
  await drain(30_000); // the queued fetch is a no-op without enabled profiles
});

test("ingest: dedupe, hard filters, agency detection", () => {
  const base = { source: "jobroom", company: "Contoro AG", location: "Zürich", description: desc("Bewerbung an jobs@contoro.example") };
  const a = ingest({ ...base, sourceId: "1", title: "Product Owner (m/w/d)", salaryText: "CHF 110'000 – 130'000 pro Jahr" });
  const dup = ingest({ ...base, source: "jobsch", sourceId: "jc-9", title: "Product Owner (w/m/d)", company: "Contoro" });
  assert.ok(a.created && dup.merged && dup.jobId === a.jobId, "same job from two portals merges");
  assert.equal(ingest({ ...base, sourceId: "1", title: "x" }).created, false, "same posting twice is ignored");
  const agency = ingest({ ...base, sourceId: "2", title: "Product Owner", company: "Talent Partners", description: desc("Für unseren Kunden suchen wir") });
  assert.match(agency.excluded!, /Recruiter/);
  const cheap = ingest({ ...base, sourceId: "3", title: "Junior PO", company: "Billig AG", salaryText: "CHF 60'000 – 70'000" });
  assert.match(cheap.excluded!, /Salary below/);
  const blocked = ingest({ ...base, sourceId: "4", title: "Werkstudent Product", company: "Uni Shop" });
  assert.match(blocked.excluded!, /Werkstudent/);
  for (let i = 0; i < 9; i++) ingest({ ...base, sourceId: `x${i}`, company: `Firma ${i}`, title: i % 2 ? "Product Owner Data" : "Logistics Coordinator", description: i % 2 ? desc() : "Lager und Logistik, Staplerschein" });
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE stage = 'new'")!.n, 10);
});

test("scoring moves every new job to Discover with reasons", async () => {
  schedule();
  await drain(60_000);
  const rows = all<{ stage: string; score: number; score_json: string }>("SELECT stage, score, score_json FROM jobs WHERE stage NOT IN ('excluded','closed')");
  assert.ok(rows.every((r) => r.stage === "discover" && r.score >= 0 && JSON.parse(r.score_json).reasons_for.length));
  const po = get<{ s: number }>("SELECT AVG(score) AS s FROM jobs WHERE title LIKE 'Product Owner%' AND stage = 'discover'")!.s;
  const logi = get<{ s: number }>("SELECT AVG(score) AS s FROM jobs WHERE title LIKE 'Logistics%'")!.s;
  assert.ok(po > logi, `matching roles score higher (${po} vs ${logi})`);
});

test("decisions: reject with reason, skip, undo", async () => {
  const [l1, l2] = all<{ id: number }>("SELECT id FROM jobs WHERE title LIKE 'Logistics%' ORDER BY id");
  await dispatch("decide", { jobId: l1.id, kind: "reject", reason: "Wrong industry" });
  assert.equal(getJob(l1.id)!.stage, "closed");
  const r = (await dispatch("decide", { jobId: l2.id, kind: "skip" })) as { prev: { stage: string } };
  assert.equal(getJob(l2.id)!.stage, "later");
  await dispatch("undo", { jobId: l2.id, stage: r.prev.stage });
  assert.equal(getJob(l2.id)!.stage, "discover");
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM signals WHERE job_id = ?", [l2.id])!.n, 0, "undo removes the signal");
});

let jobId = 0;
test("apply → draft with fact-check and a merged PDF bundle", async () => {
  jobId = get<{ id: number }>("SELECT id FROM jobs WHERE stage = 'discover' ORDER BY (apply_email IS NOT NULL) DESC, id LIMIT 1")!.id;
  await dispatch("decide", { jobId, kind: "dream" });
  await dispatch("decide", { jobId, kind: "apply" });
  assert.equal(getJob(jobId)!.stage, "shortlist");
  await drain(90_000);
  const job = getJob(jobId)!;
  assert.equal(job.stage, "review");
  const app = get<{ id: number; letter: string; factcheck_json: string; bundle_path: string; language: string }>("SELECT * FROM applications WHERE job_id = ?", [jobId])!;
  assert.equal(app.language, "de");
  assert.match(app.letter, /Alex Neumann/);
  assert.match(app.letter, /Freundliche Grüsse/, "Swiss closing");
  assert.doesNotMatch(app.letter, /ß/, "Swiss spelling: no ß");
  assert.ok(JSON.parse(app.factcheck_json).claims.length > 0, "letter was fact-checked");
  assert.ok(fs.existsSync(app.bundle_path), "bundle PDF written");
  assert.match(path.basename(app.bundle_path), /^Bewerbung_Neumann_Contoro/);
  const pdf = await PDFDocument.load(fs.readFileSync(app.bundle_path));
  assert.ok(pdf.getPageCount() >= 3, `letter + CV + reference (${pdf.getPageCount()} pages)`);
  assert.ok(get("SELECT brief_md FROM companies WHERE id = ?", [job.company_id]), "company brief cached");
});

test("edit, rewrite with an instruction, approve, send", async () => {
  const app = get<{ id: number; letter: string }>("SELECT id, letter FROM applications WHERE job_id = ? ORDER BY version DESC", [jobId])!;
  await dispatch("saveLetter", { appId: app.id, letter: app.letter + "\n\nPS: Edited." });
  assert.match(get<{ letter: string }>("SELECT letter FROM applications WHERE id = ?", [app.id])!.letter, /PS: Edited/);
  await dispatch("regenerate", { jobId, instruction: "shorter" });
  await drain(90_000);
  const v2 = get<{ id: number; version: number; instruction: string }>("SELECT id, version, instruction FROM applications WHERE job_id = ? ORDER BY version DESC", [jobId])!;
  assert.equal(v2.version, 2);
  assert.equal(v2.instruction, "shorter");
  await dispatch("saveAnswers", { appId: v2.id, recipient: "Frau Jansen", salary: "CHF 130'000" });
  assert.match(get<{ answers_json: string }>("SELECT answers_json FROM applications WHERE id = ?", [v2.id])!.answers_json, /Frau Jansen.*|CHF 130'000/);
  await dispatch("approve", { appId: v2.id, seconds: 42 });
  assert.equal(getJob(jobId)!.stage, "ready", "approved drafts wait in Ready to send");
  await dispatch("unapprove", { jobId });
  assert.equal(getJob(jobId)!.stage, "review", "can go back for more edits");
  await dispatch("move", { jobId, to: "ready" });
  assert.equal(getJob(jobId)!.stage, "ready", "dragging to Ready to send approves");
  const mail = (await dispatch("mailDraft", { jobId })) as { ok: boolean; message: string };
  assert.ok(mail.ok, mail.message);
  const form = (await dispatch("openForm", { jobId })) as { ok: boolean; message: string };
  assert.ok(!form.ok && /No application link/.test(form.message), "no form without a link");
  await dispatch("markSent", { jobId, channel: "email" });
  assert.equal(getJob(jobId)!.stage, "applied");
  assert.equal(get<{ channel: string }>("SELECT channel FROM applications WHERE id = ?", [v2.id])!.channel, "email");
  assert.equal(get<{ review_seconds: number }>("SELECT review_seconds FROM applications WHERE id = ?", [v2.id])!.review_seconds, 42);
});

test("follow-up is drafted after 14 days of silence", async () => {
  run("UPDATE jobs SET stage_changed_at = datetime('now','-20 days'), next_action = NULL WHERE id = ?", [jobId]);
  run("UPDATE applications SET sent_at = datetime('now','-20 days') WHERE job_id = ?", [jobId]);
  run("DELETE FROM settings WHERE key = '_lastRun:followups'");
  schedule();
  await drain(30_000);
  assert.match(getJob(jobId)!.next_action ?? "", /^Follow up/);
  assert.ok(get("SELECT 1 FROM events WHERE job_id = ? AND type = 'followup'", [jobId]));
});

test("interview: moving to Round 1 creates a prep pack and an outcome signal", async () => {
  await dispatch("move", { jobId, to: "contact" });
  await dispatch("move", { jobId, to: "round1", note: "On-site Tue 10:30" });
  await drain(60_000);
  assert.equal(getJob(jobId)!.stage, "round1");
  assert.ok(get("SELECT markdown FROM prep_packs WHERE job_id = ?", [jobId]));
  assert.ok(get("SELECT 1 FROM signals WHERE job_id = ? AND kind = 'outcome_round1'", [jobId]));
});

test("manual ad from pasted text, applied right away", async () => {
  const r = (await dispatch("addManual", { text: "Product Owner Payments (m/w/d)\nNordbank AG, Zürich\nWir suchen dich für unser Payments-Team. Bewerbung an karriere@nordbank.example", note: "Referred by Jana", applyNow: true })) as { jobId: number };
  const j = getJob(r.jobId)!;
  assert.equal(j.manual, 1);
  assert.equal(j.note, "Referred by Jana");
  assert.equal(j.stage, "shortlist");
  await drain(90_000);
  assert.equal(getJob(r.jobId)!.stage, "review");
});

test("learning: the profile is rewritten from decisions and can be reverted", async () => {
  for (const x of all<{ id: number }>("SELECT id FROM jobs WHERE stage = 'discover' LIMIT 4")) await dispatch("decide", { jobId: x.id, kind: "reject", reason: "Agency / consultancy" });
  await dispatch("reflectNow", {});
  await drain(30_000);
  const p = currentProfile()!;
  assert.ok(p.version >= 2);
  assert.equal(p.created_by, "claude");
  await dispatch("revertProfile", { version: 1 });
  assert.equal(currentProfile()!.markdown, get<{ markdown: string }>("SELECT markdown FROM profile_versions WHERE version = 1")!.markdown);
});

test("blocking a company hides its open ads", async () => {
  const j = get<{ id: number; company_id: number }>("SELECT id, company_id FROM jobs WHERE stage = 'discover' LIMIT 1");
  if (!j) return;
  await dispatch("blockCompany", { jobId: j.id });
  assert.equal(getJob(j.id)!.stage, "excluded");
});

test("job alerts from a Gmail label become jobs, each email once", async () => {
  const { runAlerts } = await import("@/lib/pipeline/sources");
  const { ALERT } = await import("./fixtures/alert-email");
  setSettings({ alertsLabel: "Job alerts", gmailAddress: "alex.neumann@gmail.com" });
  const mails = [{ id: "<m1@linkedin.com>", sender: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", subject: "Product Manager in Zürich", source: ALERT }];
  assert.match(await runAlerts(async () => mails), /2 new of 2 from 1 email/);
  const j = get<{ title: string; source: string }>("SELECT j.title, p.source FROM jobs j JOIN postings p ON p.job_id = j.id WHERE p.source_id = 'linkedin:4012345678'");
  assert.equal(j?.source, "alert-linkedin");
  assert.match(await runAlerts(async () => mails), /0 new of 0 from 0 emails/, "same email is not read twice");
});

test("Gmail: a sent application moves to Applied, replies move it on", async () => {
  const { syncGmail } = await import("@/lib/pipeline/mailsync");
  const me = "alex.neumann@gmail.com";
  setSettings({ gmailAddress: me });
  const nord = get<{ id: number }>("SELECT j.id FROM jobs j JOIN companies c ON c.id = j.company_id WHERE c.name LIKE 'Nordbank%'")!.id;
  const app = get<{ id: number }>("SELECT id FROM applications WHERE job_id = ? ORDER BY version DESC", [nord])!;
  await dispatch("approve", { appId: app.id, seconds: 30 });
  assert.equal(getJob(nord)!.stage, "ready");
  const at = () => new Date(Date.now() + 2000).toISOString();
  const mail = (id: string, from: string, to: string, subject: string, body: string) => ({
    id, from, fromAddress: from, to: [to], subject, date: at(), source: `Content-Type: text/plain; charset=utf-8\r\n\r\n${body}`,
  });
  const terms: string[][] = [];
  const read = (mails: ReturnType<typeof mail>[]) => async (t: string[]) => (terms.push(t), mails);

  assert.match(await syncGmail(read([mail("<s1>", me, "karriere@nordbank.example", "Bewerbung", "Anbei meine Bewerbung")])), /1 job moved/);
  assert.equal(getJob(nord)!.stage, "applied", "sent from Gmail");
  assert.ok(terms[0].includes("karriere@nordbank.example"), "searched for the application address");

  await syncGmail(read([mail("<r1>", "noreply@nordbank.example", me, "Eingangsbestätigung", "Vielen Dank, Ihre Bewerbung ist bei uns eingegangen.")]));
  assert.equal(getJob(nord)!.stage, "applied", "a receipt changes nothing");
  assert.ok(get("SELECT 1 FROM events WHERE job_id = ? AND text LIKE '%confirmed your application arrived%'", [nord]));

  await syncGmail(read([mail("<r2>", "personal@nordbank.example", me, "Einladung zum Vorstellungsgespräch", "Wir möchten Sie gern kennenlernen.")]));
  assert.equal(getJob(nord)!.stage, "contact", "an invitation from anyone at the company moves it to In contact");
  assert.match(getJob(nord)!.next_action ?? "", /interview slot/);

  const before = all("SELECT id FROM events WHERE job_id = ?", [nord]).length;
  await syncGmail(read([mail("<r2>", "personal@nordbank.example", me, "Einladung zum Vorstellungsgespräch", "Wir möchten Sie gern kennenlernen.")]));
  assert.equal(all("SELECT id FROM events WHERE job_id = ?", [nord]).length, before, "the same email is handled once");

  const email = getJob(jobId)!.apply_email!;
  await syncGmail(read([mail("<r3>", `hr@${email.split("@")[1]}`, me, "Ihre Bewerbung", "Leider müssen wir Ihnen mitteilen, dass wir uns für andere Kandidaten entschieden haben.")]));
  const j = getJob(jobId)!;
  assert.equal(j.stage, "closed");
  assert.equal(j.closed_reason, "rejected");
});

test("Gmail draft: encoded subject, the PDF attached", async () => {
  const { buildMime } = await import("@/lib/gmail");
  const pdf = get<{ bundle_path: string }>("SELECT bundle_path FROM applications WHERE bundle_path IS NOT NULL LIMIT 1")!.bundle_path;
  const raw = buildMime({ from: { name: "Alex Neumann", address: "alex.neumann@gmail.com" }, to: "jobs@firma.example", subject: "Bewerbung als Produktmanager:in – Zahlungsverkehr", body: "Guten Tag,\nanbei meine Unterlagen.", attachments: [pdf], messageId: "<t1@jobfinder.local>" });
  assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(raw, /^To: jobs@firma\.example$/m);
  assert.match(raw, /Content-Type: application\/pdf; name="Bewerbung_Neumann/);
  const b64 = raw.split("Content-Transfer-Encoding: base64\r\n\r\n")[2].split("\r\n--")[0].replace(/\r\n/g, "");
  assert.equal(Buffer.from(b64, "base64").subarray(0, 5).toString(), "%PDF-", "attachment is the PDF");
  assert.ok(raw.split("\r\n").every((l) => l.length <= 998), "no over-long lines");
});

test("an ad captured from the browser is added with its full text", async () => {
  const { addManualAd } = await import("@/lib/pipeline/sources");
  const html = `<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Product Owner Checkout","hiringOrganization":{"name":"Galaxus AG"},"jobLocation":{"address":{"addressLocality":"Zürich"}},"description":"${"Du gestaltest den Checkout. ".repeat(20)}"}</script></head><body>…</body></html>`;
  const id = await addManualAd({ url: "https://ch.indeed.com/viewjob?jk=1234567890abcdef", html });
  const j = getJob(id)!;
  assert.equal(j.company, "Galaxus AG");
  assert.equal(j.manual, 1);
  assert.match(j.description, /Checkout/);
});

test("no task failed along the way", () => {
  assert.deepEqual(all("SELECT type, error FROM tasks WHERE status = 'failed'"), []);
});
