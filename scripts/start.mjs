// Starts the web app and the background worker together. `node scripts/start.mjs dev` for development.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";

const dev = process.argv[2] === "dev";
const port = process.env.PORT ?? "4317";
const bin = (n) => `node_modules/.bin/${n}`;

// another JobFinder (or anything else) on the port: say so before building, so a running server is never rebuilt underneath
const busy = await new Promise((r) => {
  const sock = net.connect(Number(port), "127.0.0.1", () => { sock.destroy(); r(true); });
  sock.on("error", () => r(false));
});
if (busy) {
  console.log(`[kompass] already running at http://localhost:${port} – open that, or stop the other one first (Ctrl+C in its terminal).`);
  process.exit(0);
}

// fingerprint of the code the build was made from: file contents, since editors touch mtimes without changing anything
const hash = createHash("sha1");
const add = (p) => {
  const st = fs.statSync(p, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isDirectory()) for (const f of fs.readdirSync(p).sort()) add(`${p}/${f}`);
  else hash.update(p).update(fs.readFileSync(p));
};
["app", "lib", "next.config.mjs", "package.json"].forEach(add);
const DIST = process.env.KOMPASS_DIST_DIR || ".next";
const STAMP = `${DIST}/kompass-source`;
const source = hash.digest("hex");
const built = fs.existsSync(`${DIST}/BUILD_ID`) && fs.existsSync(`${DIST}/required-server-files.json`);
const stamp = fs.existsSync(STAMP) ? fs.readFileSync(STAMP, "utf8") : null;
if (!dev && (!built || stamp !== source)) {
  console.log(`[kompass] ${built ? "code changed" : "first start"}: building the app (takes a minute)…`);
  const b = spawn(bin("next"), ["build"], { stdio: "inherit" });
  const code = await new Promise((r) => b.on("close", r));
  if (code !== 0) process.exit(code);
  fs.writeFileSync(STAMP, source);
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
