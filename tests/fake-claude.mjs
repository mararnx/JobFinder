#!/usr/bin/env node
// Stand-in for the Claude Code CLI in tests. Behaviour is chosen by FAKE_CLAUDE.
import fs from "node:fs";

const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("9.9.9 (Fake Claude)"); process.exit(0); }
let input = "";
for await (const c of process.stdin) input += c;
const mode = process.env.FAKE_CLAUDE ?? "ok";
const counter = process.env.FAKE_CLAUDE_COUNTER;
const n = counter ? Number(fs.existsSync(counter) ? fs.readFileSync(counter, "utf8") : 0) + 1 : 1;
if (counter) fs.writeFileSync(counter, String(n));
const envelope = (result, is_error = false) => JSON.stringify({ type: "result", subtype: is_error ? "error" : "success", is_error, result, args });

if (mode === "limit") { console.log(envelope("Claude AI usage limit reached|1893456000", true)); process.exit(1); }
if (mode === "bad-then-ok" && n === 1) { console.log(envelope("Sure! Here is the profile you asked for.")); process.exit(0); }
const model = args[args.indexOf("--model") + 1];
console.log(envelope("Here you go:\n```json\n" + JSON.stringify({ markdown: `## Wants\n- model ${model}\n- prompt had ${input.length} chars`, diff_summary: "ok" }) + "\n```"));
