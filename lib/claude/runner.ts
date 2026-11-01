import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { getSettings, run } from "@/lib/db";
import { mockResponse } from "./mock";

export type Model = "haiku" | "sonnet" | "opus";

export class RateLimitError extends Error {
  constructor(message: string, public resetAt: Date) {
    super(message);
  }
}

let cliCache: { ok: boolean; version?: string; at: number } | null = null;

export function claudeCli(): { ok: boolean; version?: string } {
  if (cliCache && Date.now() - cliCache.at < 60_000) return cliCache;
  const r = spawnSync(process.env.CLAUDE_BIN ?? "claude", ["--version"], { encoding: "utf8", timeout: 10_000 });
  cliCache = { ok: r.status === 0, version: r.stdout?.trim(), at: Date.now() };
  return cliCache;
}

export function isMock(): boolean {
  if (process.env.KOMPASS_CLAUDE === "mock") return true;
  if (process.env.KOMPASS_CLAUDE === "real") return false;
  const mode = getSettings().claudeMode;
  if (mode === "mock") return true;
  if (mode === "real") return false;
  return !claudeCli().ok;
}

const PROMPT_DIR = path.join(process.cwd(), "prompts");

/** Loads prompts/<name>.md and fills {{placeholders}}. */
export function renderPrompt(name: string, vars: Record<string, string | number>): string {
  const tpl = fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), "utf8");
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`prompt ${name}: missing variable ${k}`);
    return String(vars[k]);
  });
}

/** Pulls the first JSON object/array out of a model reply (tolerates fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("no JSON in reply");
  const open = body[start], close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error("unterminated JSON in reply");
}

function parseReset(msg: string): Date {
  // CLI messages look like "… limit reached ∙ resets 3pm" or include an epoch; fall back to 30 min.
  const epoch = msg.match(/\|(\d{10})\b/);
  if (epoch) return new Date(Number(epoch[1]) * 1000);
  const hm = msg.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (hm) {
    const d = new Date();
    let h = Number(hm[1]) % 12;
    if (hm[3]?.toLowerCase() === "pm" || (!hm[3] && Number(hm[1]) >= 12)) h += 12;
    d.setHours(h, Number(hm[2] ?? 0), 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return d;
  }
  return new Date(Date.now() + 30 * 60_000);
}

function callCli(prompt: string, model: Model, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.CLAUDE_BIN ?? "claude",
      ["-p", "--output-format", "json", "--model", model, "--max-turns", "1", "--disallowedTools", "Bash,Edit,Write,Read,WebFetch,WebSearch,Glob,Grep,Task,NotebookEdit"],
      { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } },
    );
    let out = "", err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let envelope: { is_error?: boolean; result?: string; subtype?: string } | null = null;
      try {
        envelope = JSON.parse(out);
      } catch {
        /* fall through */
      }
      const text = envelope?.result ?? "";
      const all = `${text}\n${err}`;
      if (/usage limit|rate limit|limit reached|too many requests|429/i.test(all) && (code !== 0 || envelope?.is_error)) {
        return reject(new RateLimitError(all.trim().slice(0, 300), parseReset(all)));
      }
      if (code !== 0 || !envelope || envelope.is_error) {
        return reject(new Error(`claude exited ${code}: ${(text || err || out).trim().slice(0, 400)}`));
      }
      resolve(text);
    });
    child.stdin.end(prompt);
  });
}

export type ClaudeCall<S extends z.ZodTypeAny> = {
  name: string; // prompt name, for logging and mocks
  prompt: string;
  model: Model;
  schema: S;
  mockInput?: unknown; // structured input the mock uses to produce a realistic answer
  timeoutMs?: number;
};

/** Runs one Claude call, validates JSON output against the schema, retries once on invalid output. */
export async function claude<S extends z.ZodTypeAny>(call: ClaudeCall<S>): Promise<z.infer<S>> {
  const mock = isMock();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const raw = mock
        ? JSON.stringify(await mockResponse(call.name, call.mockInput))
        : await callCli(
            attempt === 1 ? call.prompt : `${call.prompt}\n\nYour previous reply was not valid JSON for the required schema. Reply with ONLY the JSON.`,
            call.model,
            call.timeoutMs ?? 240_000,
          );
      const parsed = call.schema.parse(extractJson(raw));
      run("INSERT INTO claude_runs(prompt, model, ms, ok, mock) VALUES (?, ?, ?, 1, ?)", [call.name, call.model, Date.now() - started, mock ? 1 : 0]);
      return parsed;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      run("INSERT INTO claude_runs(prompt, model, ms, ok, mock, error) VALUES (?, ?, ?, 0, ?, ?)", [call.name, call.model, Date.now() - started, mock ? 1 : 0, msg.slice(0, 500)]);
      if (e instanceof RateLimitError || attempt === 2) throw e;
    }
  }
  throw new Error("unreachable");
}
