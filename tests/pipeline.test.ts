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
  setSettings({ name: "Alex Neumann", email: "alex@example.com", phone: "+49 151 0000000", address: "Musterstraße 1, 20095 Hamburg", home: "Hamburg", salaryFloor: 60000, salaryExpectation: "€85,000", noticePeriod: "3 months", earliestStart: "Feb 1, 2027", blockKeywords: ["Werkstudent"], excludeAgencies: true });
  run("INSERT INTO search_profiles(name, keywords, location, radius_km, enabled) VALUES ('Main', ?, 'Hamburg', 30, 0)", [JSON.stringify(["Product Owner"])]); // disabled: no network in tests
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
  const base = { source: "arbeitsagentur", company: "Contoro GmbH", location: "Hamburg", description: desc("Bewerbung an jobs@contoro.example") };
  const a = ingest({ ...base, sourceId: "1", title: "Product Owner (m/w/d)", salaryText: "70000 – 85000 € pro Jahr" });
  const dup = ingest({ ...base, source: "stepstone", sourceId: "ss-9", title: "Product Owner (w/m/d)", company: "Contoro" });
  assert.ok(a.created && dup.merged && dup.jobId === a.jobId, "same job from two portals merges");
  assert.equal(ingest({ ...base, sourceId: "1", title: "x" }).created, false, "same posting twice is ignored");
  const agency = ingest({ ...base, sourceId: "2", title: "Product Owner", company: "Talent Partners", description: desc("Für unseren Kunden suchen wir") });
  assert.match(agency.excluded!, /Recruiter/);
  const cheap = ingest({ ...base, sourceId: "3", title: "Junior PO", company: "Billig AG", salaryText: "30000 – 40000 €" });
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
  const res = (await dispatch("approve", { appId: v2.id, seconds: 42 })) as { channel: string; ok: boolean };
  assert.equal(res.channel, "email");
  assert.ok(res.ok);
  await dispatch("markSent", { jobId });
  assert.equal(getJob(jobId)!.stage, "applied");
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
  const r = (await dispatch("addManual", { text: "Product Owner Payments (m/w/d)\nNordbank AG, Hamburg\nWir suchen dich für unser Payments-Team. Bewerbung an karriere@nordbank.example", note: "Referred by Jana", applyNow: true })) as { jobId: number };
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

test("no task failed along the way", () => {
  assert.deepEqual(all("SELECT type, error FROM tasks WHERE status = 'failed'"), []);
});
