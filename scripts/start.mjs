// Starts the web app and the background worker together. `node scripts/start.mjs dev` for development.
import { spawn } from "node:child_process";
import fs from "node:fs";

const dev = process.argv[2] === "dev";
const port = process.env.PORT ?? "4317";
const bin = (n) => `node_modules/.bin/${n}`;

if (!dev && !fs.existsSync(".next/BUILD_ID")) {
  console.log("[kompass] first start: building the app (takes a minute)…");
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
