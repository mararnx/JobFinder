import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kompass-cli-"));
process.env.KOMPASS_DATA = tmp;
process.env.KOMPASS_CLAUDE = "real";
process.env.CLAUDE_BIN = path.resolve("tests/fake-claude.mjs");

const { claude, claudeCli, extractJson, RateLimitError } = await import("@/lib/claude/runner");
const { ProfileDoc } = await import("@/lib/claude/schemas");
const { all } = await import("@/lib/db");

test("extractJson tolerates prose, fences and braces in strings", () => {
  assert.deepEqual(extractJson('Sure:\n```json\n{"a":"x}y","b":[1,2]}\n```'), { a: "x}y", b: [1, 2] });
  assert.deepEqual(extractJson('prefix {"a":{"b":"\\"q\\""}} trailing'), { a: { b: '"q"' } });
  assert.throws(() => extractJson("no json here"));
});

test("detects the CLI", () => {
  assert.equal(claudeCli().ok, true);
});

test("calls the CLI with the model, parses and validates the reply", async () => {
  process.env.FAKE_CLAUDE = "ok";
  const r = await claude({ name: "reflect-profile", model: "opus", schema: ProfileDoc, prompt: "hello world" });
  assert.match(r.markdown, /model opus/);
  assert.match(r.markdown, /prompt had 11 chars/);
});

test("retries once when the reply has no valid JSON", async () => {
  process.env.FAKE_CLAUDE = "bad-then-ok";
  process.env.FAKE_CLAUDE_COUNTER = path.join(tmp, "counter");
  const r = await claude({ name: "reflect-profile", model: "sonnet", schema: ProfileDoc, prompt: "p" });
  assert.match(r.markdown, /model sonnet/);
  const runs = all<{ ok: number }>("SELECT ok FROM claude_runs WHERE model = 'sonnet'");
  assert.deepEqual(runs.map((x) => x.ok), [0, 1]);
  delete process.env.FAKE_CLAUDE_COUNTER;
});

test("usage limit becomes a RateLimitError with the reset time", async () => {
  process.env.FAKE_CLAUDE = "limit";
  await assert.rejects(
    claude({ name: "reflect-profile", model: "haiku", schema: ProfileDoc, prompt: "p" }),
    (e: unknown) => e instanceof RateLimitError && e.resetAt.getTime() === 1893456000 * 1000,
  );
});
