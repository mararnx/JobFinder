// Starts the web app and the background worker together. `node scripts/start.mjs dev` for development.
import { spawn } from "node:child_process";
import fs from "node:fs";

const dev = process.argv[2] === "dev";
const port = process.env.PORT ?? "4317";
const bin = (n) => `node_modules/.bin/${n}`;

// newest change to anything that ends up in the build
const newest = (p) => {
  const st = fs.statSync(p, { throwIfNoEntry: false });
  if (!st) return 0;
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(st.mtimeMs, ...fs.readdirSync(p).map((f) => newest(`${p}/${f}`)));
};
const built = fs.statSync(".next/BUILD_ID", { throwIfNoEntry: false })?.mtimeMs ?? 0;
const sources = Math.max(...["app", "lib", "next.config.mjs", "package.json"].map(newest));
if (!dev && (!built || sources > built || !fs.existsSync(".next/required-server-files.json"))) {
  console.log(`[kompass] ${built ? "code changed" : "first start"}: building the app (takes a minute)…`);
  const b = spawn(bin("next"), ["build"], { stdio: "inherit" });
  const code = await new Promise((r) => b.on("close", r));
  if (code !== 0) process.exit(code);
}

const procs = [
  spawn(bin("next"), [dev ? "dev" : "start", "-p", port, "-H", "127.0.0.1"], { stdio: "inherit" }),
  spawn(bin("tsx"), [...(dev ? ["watch", "--clear-screen=false"] : []), "worker/index.ts"], { stdio: "inherit" }),
];
console.log(`[kompass] open http://localhost:${port}`);

const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("close", (code) => { stop(); process.exitCode = code ?? 0; });
