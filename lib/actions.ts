import fs from "node:fs";
import { get, getSettings, logEvent, run, setSettings, type Settings } from "@/lib/db";
import { addSignal, BOARD, getJob, setStage, type Stage } from "@/lib/jobs";
import { approve, latestApplication, markSent, saveLetterEdit } from "@/lib/pipeline/drafting";
import { DOC_KINDS, type DocKind } from "@/lib/pipeline/documents";
import { initialProfile } from "@/lib/pipeline/scoring";
import { addManualAd, watchlistAdd } from "@/lib/pipeline/sources";
import { openApplyForm, openMailDraft } from "@/lib/pipeline/send";
import { saveProfile } from "@/lib/profile";
import { enqueue, PRIORITY, setMeta } from "@/lib/queue";

const n = (v: unknown) => {
  const x = Number(v);
  if (!Number.isFinite(x)) throw new Error("invalid id");
  return x;
};
const s = (v: unknown, max = 20000) => String(v ?? "").slice(0, max);

type A = Record<string, unknown>;

export const actions: Record<string, (a: A) => Promise<unknown> | unknown> = {
  /* ── Discover ── */
  decide: (a) => {
    const jobId = n(a.jobId);
    const job = getJob(jobId);
    if (!job) throw new Error("job not found");
    const kind = s(a.kind);
    const prev = { stage: job.stage, dream: job.dream };
    if (kind === "dream" || kind === "undream") {
      run("UPDATE jobs SET dream = ? WHERE id = ?", [kind === "dream" ? 1 : 0, jobId]);
      addSignal(jobId, kind, null);
      return { prev };
    }
    if (kind === "apply") {
      addSignal(jobId, "apply", null);
      setStage(jobId, "shortlist");
      run("UPDATE jobs SET prep_sub = 'queued' WHERE id = ?", [jobId]);
      enqueue("draft", { jobId }, { priority: job.dream ? PRIORITY.dreamDraft : PRIORITY.draft, dedupeKey: `draft:${jobId}` });
    } else if (kind === "reject") {
      addSignal(jobId, "reject", s(a.reason, 200) || null);
      setStage(jobId, "closed", { closedReason: `not interested${a.reason ? `: ${s(a.reason, 200)}` : ""}` });
    } else if (kind === "skip") {
      addSignal(jobId, "skip", null);
      setStage(jobId, "later");
    } else throw new Error(`unknown decision ${kind}`);
    return { prev };
  },
  undo: (a) => {
    const jobId = n(a.jobId);
    const stage = s(a.stage) as Stage;
    run("DELETE FROM signals WHERE id = (SELECT MAX(id) FROM signals WHERE job_id = ?)", [jobId]);
    run("DELETE FROM tasks WHERE status = 'queued' AND dedupe_key = ?", [`draft:${jobId}`]);
    run("UPDATE jobs SET stage = ?, closed_reason = NULL, prep_sub = NULL WHERE id = ?", [stage, jobId]);
    logEvent(jobId, "undo", "Decision undone");
    return { ok: true };
  },

  /* ── Pipeline ── */
  move: (a) => {
    const jobId = n(a.jobId);
    const to = s(a.to);
    const col = BOARD.find((b) => b.key === to);
    const stage = (col ? (to === "prep" ? "shortlist" : col.stages[0]) : to) as Stage;
    const job = getJob(jobId);
    if (!job) throw new Error("job not found");
    setStage(jobId, stage, { closedReason: a.closedReason ? s(a.closedReason, 200) : undefined, note: a.note ? s(a.note, 200) : undefined });
    if (stage === "shortlist") {
      run("UPDATE jobs SET prep_sub = 'queued' WHERE id = ?", [jobId]);
      enqueue("draft", { jobId }, { priority: PRIORITY.draft, dedupeKey: `draft:${jobId}` });
    }
    if (stage === "round1") enqueue("prep_pack", { jobId }, { priority: PRIORITY.userAction, dedupeKey: `prep:${jobId}` });
    return { prev: job.stage };
  },
  setNote: (a) => {
    run("UPDATE jobs SET next_action = ?, next_action_at = datetime('now') WHERE id = ?", [s(a.note, 300) || null, n(a.jobId)]);
    if (a.note) logEvent(n(a.jobId), "note", s(a.note, 300));
    return { ok: true };
  },
  prepPack: (a) => enqueue("prep_pack", { jobId: n(a.jobId) }, { priority: PRIORITY.userAction, dedupeKey: `prep:${n(a.jobId)}` }),
  blockCompany: (a) => {
    const job = getJob(n(a.jobId));
    if (!job) throw new Error("job not found");
    run("UPDATE companies SET blocked = 1 WHERE id = ?", [job.company_id]);
    run("UPDATE jobs SET stage = 'excluded', excluded_reason = 'Company on your blocklist' WHERE company_id = ? AND stage IN ('new','discover','later')", [job.company_id]);
    return { ok: true };
  },

  /* ── Review ── */
  regenerate: (a) => {
    const jobId = n(a.jobId);
    run("UPDATE jobs SET stage = 'drafting', prep_sub = 'drafting' WHERE id = ?", [jobId]);
    enqueue("draft", { jobId, instruction: s(a.instruction, 500) }, { priority: PRIORITY.dreamDraft });
    logEvent(jobId, "regenerate", a.instruction ? `Rewrite requested: “${s(a.instruction, 200)}”` : "Rewrite requested");
    return { ok: true };
  },
  saveLetter: async (a) => {
    await saveLetterEdit(n(a.appId), s(a.letter), a.subject ? s(a.subject, 300) : undefined);
    return { ok: true };
  },
  approve: async (a) => {
    const jobId = approve(n(a.appId), Number(a.seconds) || 0);
    const job = getJob(jobId)!;
    if (job.apply_email) return { channel: "email", ...openMailDraft(jobId) };
    if (job.url) {
      const r = await openApplyForm(jobId).catch((e) => ({ ok: false, message: String(e instanceof Error ? e.message : e), filled: [] }));
      return { channel: "form", ...r };
    }
    return { channel: "none", ok: true, message: "Approved. No email or link in the ad – send the PDF yourself." };
  },
  openForm: async (a) => openApplyForm(n(a.jobId)),
  openMail: (a) => openMailDraft(n(a.jobId)),
  markSent: (a) => {
    markSent(n(a.jobId));
    return { ok: true };
  },

  /* ── Sources ── */
  fetchSources: () => enqueue("fetch_source", { source: "all" }, { priority: PRIORITY.userAction, dedupeKey: "fetch:all" }),
  fetchSource: (a) => enqueue("fetch_source", { source: s(a.source, 40) }, { priority: PRIORITY.userAction, dedupeKey: `fetch:${s(a.source, 40)}` }),
  addManual: async (a) => ({ jobId: await addManualAd({ url: s(a.url, 2000), text: s(a.text, 30000), note: s(a.note, 300), applyNow: Boolean(a.applyNow) }) }),
  watchlistAdd: (a) => ({ ats: watchlistAdd(s(a.name, 120).trim(), s(a.url, 500).trim()) }),
  watchlistRemove: (a) => run("UPDATE companies SET watchlist = 0 WHERE id = ?", [n(a.companyId)]),
  unblockCompany: (a) => run("UPDATE companies SET blocked = 0 WHERE id = ?", [n(a.companyId)]),
  saveSearch: (a) => {
    const kws = (Array.isArray(a.keywords) ? a.keywords : s(a.keywords).split(",")).map((k) => String(k).trim()).filter(Boolean).slice(0, 20);
    if (!kws.length) throw new Error("Add at least one keyword");
    const params = [s(a.name, 80) || "Search", JSON.stringify(kws), s(a.location, 80), Math.min(200, Math.max(0, Number(a.radius) || 30))];
    if (a.id) run("UPDATE search_profiles SET name = ?, keywords = ?, location = ?, radius_km = ? WHERE id = ?", [...params, n(a.id)]);
    else run("INSERT INTO search_profiles(name, keywords, location, radius_km) VALUES (?, ?, ?, ?)", params);
    return { ok: true };
  },
  deleteSearch: (a) => run("DELETE FROM search_profiles WHERE id = ?", [n(a.id)]),
  toggleSearch: (a) => run("UPDATE search_profiles SET enabled = 1 - enabled WHERE id = ?", [n(a.id)]),
  retryTask: (a) => run("UPDATE tasks SET status = 'queued', attempts = 0, run_after = datetime('now'), error = NULL WHERE id = ?", [n(a.taskId)]),
  resumeClaude: () => setMeta("claudePausedUntil", null),

  /* ── Profile & settings ── */
  saveSettings: (a) => {
    const patch = (a.patch ?? {}) as Partial<Settings>;
    setSettings(patch);
    return getSettings();
  },
  saveProfile: (a) => ({ version: saveProfile(s(a.markdown, 8000), "you", s(a.summary, 200) || "Edited by you") }),
  revertProfile: (a) => {
    const row = get<{ markdown: string }>("SELECT markdown FROM profile_versions WHERE version = ?", [n(a.version)]);
    if (!row) throw new Error("version not found");
    return { version: saveProfile(row.markdown, "you", `Reverted to v${n(a.version)}`) };
  },
  reflectNow: () => enqueue("reflect_profile", { force: true }, { priority: PRIORITY.userAction, dedupeKey: "reflect" }),
  finishOnboarding: async (a) => {
    type Ex = { text: string; reason: string };
    const liked = ((a.liked as Ex[]) ?? []).filter((x) => x.text?.trim());
    const disliked = ((a.disliked as Ex[]) ?? []).filter((x) => x.text?.trim());
    await initialProfile(liked, disliked);
    setSettings({ onboarded: true });
    enqueue("fetch_source", { source: "all" }, { priority: PRIORITY.userAction, dedupeKey: "fetch:all" });
    return { ok: true };
  },

  /* ── Documents ── */
  docKind: (a) => {
    const kind = s(a.kind) as DocKind;
    if (!DOC_KINDS.includes(kind)) throw new Error("unknown kind");
    run("UPDATE documents SET kind = ?, status = 'reading', attach = ? WHERE id = ?", [kind, kind === "ref" || kind === "cert" ? 1 : 0, n(a.docId)]);
    enqueue("parse_document", { docId: n(a.docId) }, { priority: PRIORITY.parse });
    return { ok: true };
  },
  docAttach: (a) => run("UPDATE documents SET attach = ? WHERE id = ?", [a.attach ? 1 : 0, n(a.docId)]),
  docDelete: (a) => {
    const d = get<{ path: string; kind: string }>("SELECT path, kind FROM documents WHERE id = ?", [n(a.docId)]);
    if (!d) return { ok: true };
    run("DELETE FROM documents WHERE id = ?", [n(a.docId)]);
    try { fs.unlinkSync(d.path); } catch { /* already gone */ }
    if (d.kind === "letter") enqueue("style_guide", {}, { priority: PRIORITY.parse, dedupeKey: "style_guide" });
    return { ok: true };
  },
};

export async function dispatch(name: string, args: A) {
  const fn = actions[name];
  if (!fn) throw new Error(`unknown action ${name}`);
  return fn(args);
}

export function hasDraft(jobId: number) {
  return !!latestApplication(jobId);
}
