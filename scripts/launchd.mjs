// Installs a launchd agent so Kompass (web + worker) starts at login and restarts if it crashes.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const label = "local.kompass";
const plist = path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);
const cwd = process.cwd();
const node = process.execPath;

if (process.argv[2] === "uninstall") {
  try { execFileSync("launchctl", ["unload", plist]); } catch { /* not loaded */ }
  fs.rmSync(plist, { force: true });
  console.log("Removed. Kompass no longer starts at login.");
  process.exit(0);
}

fs.mkdirSync(path.join(cwd, "data"), { recursive: true });
fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${path.join(cwd, "scripts/start.mjs")}</string></array>
  <key>WorkingDirectory</key><string>${cwd}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${process.env.PATH}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(cwd, "data/kompass.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(cwd, "data/kompass.log")}</string>
</dict></plist>
`);
try { execFileSync("launchctl", ["unload", plist], { stdio: "ignore" }); } catch { /* first install */ }
execFileSync("launchctl", ["load", plist]);
console.log(`Installed. Kompass starts at login: http://localhost:4317 (logs in data/kompass.log)`);
