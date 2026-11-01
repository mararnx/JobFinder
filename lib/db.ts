import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.KOMPASS_DATA ?? path.join(process.cwd(), "data");
export const FILES_DIR = path.join(DATA_DIR, "files");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS search_profiles (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '[]',
  location TEXT NOT NULL DEFAULT '', radius_km INTEGER NOT NULL DEFAULT 30,
  enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, norm TEXT NOT NULL UNIQUE, domain TEXT,
  ats_type TEXT, ats_token TEXT, careers_url TEXT, watchlist INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0, brief_md TEXT, brief_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id),
  title TEXT NOT NULL, norm_title TEXT NOT NULL, location TEXT, remote TEXT,
  salary_min INTEGER, salary_max INTEGER, salary_text TEXT, language TEXT,
  description TEXT NOT NULL DEFAULT '', url TEXT, apply_email TEXT, apply_channel TEXT,
  employment_type TEXT, is_agency INTEGER NOT NULL DEFAULT 0,
  published_at TEXT, found_at TEXT NOT NULL DEFAULT (datetime('now')),
  stage TEXT NOT NULL DEFAULT 'new', stage_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  prep_sub TEXT, closed_reason TEXT, excluded_reason TEXT,
  dream INTEGER NOT NULL DEFAULT 0, manual INTEGER NOT NULL DEFAULT 0, note TEXT,
  score INTEGER, prior REAL, score_json TEXT, scored_version INTEGER,
  repost_count INTEGER NOT NULL DEFAULT 0, next_action TEXT, next_action_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_stage ON jobs(stage);
CREATE INDEX IF NOT EXISTS jobs_company ON jobs(company_id);

CREATE TABLE IF NOT EXISTS postings (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id), source TEXT NOT NULL,
  source_id TEXT NOT NULL, url TEXT, title TEXT, fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, source_id)
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY, job_id INTEGER REFERENCES jobs(id), kind TEXT NOT NULL,
  reason TEXT, weight REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profile_versions (
  id INTEGER PRIMARY KEY, version INTEGER NOT NULL UNIQUE, markdown TEXT NOT NULL,
  diff_summary TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id), version INTEGER NOT NULL,
  language TEXT, subject TEXT, letter TEXT NOT NULL, email_body TEXT, cv_json TEXT,
  answers_json TEXT, factcheck_json TEXT, coverage_json TEXT, bundle_path TEXT,
  status TEXT NOT NULL DEFAULT 'draft', instruction TEXT, review_seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), approved_at TEXT, sent_at TEXT, channel TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, job_id INTEGER REFERENCES jobs(id), type TEXT NOT NULL,
  text TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 50, status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0, run_after TEXT NOT NULL DEFAULT (datetime('now')),
  locked_at TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), finished_at TEXT,
  dedupe_key TEXT
);
CREATE INDEX IF NOT EXISTS tasks_pick ON tasks(status, run_after, priority);

CREATE TABLE IF NOT EXISTS claude_runs (
  id INTEGER PRIMARY KEY, prompt TEXT NOT NULL, model TEXT NOT NULL, ms INTEGER, ok INTEGER NOT NULL,
  mock INTEGER NOT NULL DEFAULT 0, error TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL,
  size INTEGER NOT NULL, text TEXT, parsed_json TEXT, status TEXT NOT NULL DEFAULT 'reading',
  note TEXT, attach INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_runs (
  id INTEGER PRIMARY KEY, source TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT, found INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running', message TEXT
);

CREATE TABLE IF NOT EXISTS prep_packs (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id), markdown TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) return instance;
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const d = new DatabaseSync(path.join(DATA_DIR, "kompass.db"));
  d.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  d.exec(SCHEMA);
  instance = d;
  return d;
}

type Params = Record<string, SQLInputValue> | SQLInputValue[];

function bind(params?: Params): SQLInputValue[] | [Record<string, SQLInputValue>] {
  if (!params) return [];
  return Array.isArray(params) ? params : [params];
}

export function all<T = Record<string, unknown>>(sql: string, params?: Params): T[] {
  // node:sqlite returns null-prototype rows; copy them so they can cross to React client components
  return db().prepare(sql).all(...(bind(params) as SQLInputValue[])).map((r) => ({ ...r })) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, params?: Params): T | undefined {
  const r = db().prepare(sql).get(...(bind(params) as SQLInputValue[]));
  return (r ? { ...r } : undefined) as T | undefined;
}

export function run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
  const r = db().prepare(sql).run(...(bind(params) as SQLInputValue[]));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

/* ── settings ─────────────────────────────────────────── */

export type Settings = {
  name: string;
  email: string;
  phone: string;
  address: string;
  home: string;
  commuteKm: number;
  remoteMin: number; // minimum remote days/week, 0 = no requirement
  salaryFloor: number;
  salaryExpectation: string;
  noticePeriod: string;
  earliestStart: string;
  languages: string[];
  excludeAgencies: boolean;
  blockKeywords: string[];
  weeklyGoal: number;
  letterInstructions: string; // pasted from the job seeker's own Claude project, if they have one
  claudeMode: "auto" | "real" | "mock";
  claudeParallel: number;
  chromeEnabled: boolean;
  chromePortals: string[]; // which portals the Chrome search visits; Indeed and StepStone block it, so they start off
  chromeDailyPages: number;
  adzunaAppId: string; // free keys from developer.adzuna.com
  adzunaAppKey: string;
  joobleKey: string; // free key from jooble.org/api/about
  alertsMailbox: string; // Apple Mail mailbox that collects portal job-alert emails ("" = off)
  onboarded: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  name: "",
  email: "",
  phone: "",
  address: "",
  home: "",
  commuteKm: 40,
  remoteMin: 0,
  salaryFloor: 0,
  salaryExpectation: "",
  noticePeriod: "",
  earliestStart: "",
  languages: ["de", "en"],
  excludeAgencies: true,
  blockKeywords: [],
  weeklyGoal: 30,
  letterInstructions: "",
  claudeMode: "auto",
  claudeParallel: 1,
  chromeEnabled: false,
  chromePortals: ["xing", "linkedin"],
  chromeDailyPages: 40,
  adzunaAppId: "",
  adzunaAppKey: "",
  joobleKey: "",
  alertsMailbox: "",
  onboarded: false,
};

export function getSettings(): Settings {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\'");
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out as Settings;
}

export function setSettings(patch: Partial<Settings>) {
  tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      run("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [k, JSON.stringify(v)]);
    }
  });
}

/* ── small helpers ────────────────────────────────────── */

export function logEvent(jobId: number | null, type: string, text: string) {
  run("INSERT INTO events(job_id, type, text) VALUES (?, ?, ?)", [jobId, type, text]);
}

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
