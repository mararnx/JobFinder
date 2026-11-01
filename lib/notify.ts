import { spawn } from "node:child_process";

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** macOS notification; silently ignored elsewhere or in tests. */
export function notify(title: string, message: string) {
  if (process.platform !== "darwin" || process.env.KOMPASS_NO_NOTIFY) return;
  spawn("osascript", ["-e", `display notification ${q(message)} with title ${q("JobFinder")} subtitle ${q(title)}`], { stdio: "ignore", detached: true }).unref();
}
