/**
 * Gmail over IMAP with an app password: application drafts with the PDF attached, job-alert emails from a label,
 * and recent mail to and from companies for the sent / reply check. The app password lives in the macOS Keychain,
 * never in data/. Dry-run installs (tests, demo) never touch Gmail or the Keychain.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { getSettings } from "@/lib/db";

const KEYCHAIN = "JobFinder Gmail";
export const dryRun = () => !!process.env.KOMPASS_DRY_SEND;

/* ── app password in the Keychain ─────────────────────── */

/** Google shows app passwords as four groups of four letters; spaces are optional. */
export function cleanAppPassword(pw: string): string | null {
  const p = pw.replace(/\s+/g, "").toLowerCase();
  return /^[a-z]{16}$/.test(p) ? p : null;
}

function keychainPassword(address: string): string | null {
  const r = spawnSync("security", ["find-generic-password", "-s", KEYCHAIN, "-a", address, "-w"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function saveKeychainPassword(address: string, password: string) {
  // through stdin, so the password never shows up in the process list
  const r = spawnSync("security", ["-i"], { input: `add-generic-password -U -s "${KEYCHAIN}" -a "${address}" -w "${password}"\n`, encoding: "utf8" });
  if (r.status !== 0 || /error/i.test(r.stderr)) throw new Error("Couldn't save the app password in the Keychain");
}

export function forgetGmail(address: string) {
  if (!dryRun()) spawnSync("security", ["delete-generic-password", "-s", KEYCHAIN, "-a", address]);
}

/* ── connection ───────────────────────────────────────── */

function friendly(e: unknown): Error {
  const err = e as { authenticationFailed?: boolean; code?: string; message?: string };
  if (err.authenticationFailed) return new Error("Gmail didn't accept the address and app password. Check both, or create a new app password.");
  if (err.code === "ENOTFOUND" || err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED") return new Error("Can't reach Gmail – is this Mac online?");
  return new Error(`Gmail: ${(err.message ?? String(e)).slice(0, 200)}`);
}

async function connect(address: string, pass: string): Promise<ImapFlow> {
  const c = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: address, pass }, logger: false });
  c.on("error", () => {}); // a dropped connection surfaces as a failed call instead of crashing the worker
  try {
    await c.connect();
  } catch (e) {
    throw friendly(e);
  }
  return c;
}

async function withGmail<T>(fn: (c: ImapFlow, address: string) => Promise<T>): Promise<T> {
  const address = getSettings().gmailAddress;
  if (!address) throw new Error("Gmail isn't connected yet – Sources → Gmail");
  const pass = keychainPassword(address);
  if (!pass) throw new Error("The Gmail app password is missing – connect Gmail again under Sources");
  const c = await connect(address, pass);
  try {
    return await fn(c, address);
  } catch (e) {
    throw e instanceof Error && e.message.startsWith("Gmail") ? e : friendly(e);
  } finally {
    await c.logout().catch(() => {});
  }
}

/** Gmail's own folders by role, so a German Gmail ("Entwürfe", "Alle Nachrichten") works the same. */
async function specialBox(c: ImapFlow, use: "\\Drafts" | "\\All" | "\\Sent"): Promise<string> {
  const box = (await c.list()).find((b) => b.specialUse === use);
  if (!box) throw new Error(`Gmail: no ${use.slice(1)} folder found`);
  return box.path;
}

/** Checks the login, then keeps the password in the Keychain. */
export async function connectGmail(address: string, password: string): Promise<void> {
  if (dryRun()) return;
  const c = await connect(address, password);
  await c.logout().catch(() => {});
  saveKeychainPassword(address, password);
}

export function gmailUrl(address: string, hash = "#inbox") {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(address)}${hash}`;
}

/** Opens Gmail in the default browser (JobFinder runs on the same Mac as the browser). */
export function openInBrowser(url: string) {
  if (!dryRun()) spawn("open", [url], { stdio: "ignore", detached: true }).unref();
}

/* ── drafts ───────────────────────────────────────────── */

const ascii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047 encoded words, split so no line gets too long. */
function encodeWord(s: string): string {
  if (ascii(s)) return s;
  const chunks: string[] = [];
  let cur = "";
  for (const ch of s) {
    if (Buffer.byteLength(cur + ch) > 45) {
      chunks.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) chunks.push(cur);
  return chunks.map((c) => `=?UTF-8?B?${Buffer.from(c).toString("base64")}?=`).join("\r\n ");
}

const base64Lines = (b: Buffer) => b.toString("base64").replace(/.{76}/g, "$&\r\n");

export function buildMime(o: { from: { name: string; address: string }; to: string; subject: string; body: string; attachments: string[]; messageId: string; date?: Date }): string {
  const boundary = `jobfinder-${randomUUID()}`;
  const fromName = o.from.name ? (ascii(o.from.name) ? `"${o.from.name.replace(/"/g, "")}" ` : `${encodeWord(o.from.name)} `) : "";
  const head = [
    `From: ${fromName}<${o.from.address}>`,
    `To: ${o.to}`,
    `Subject: ${encodeWord(o.subject)}`,
    `Date: ${(o.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${o.messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    ["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64Lines(Buffer.from(o.body.replace(/\r?\n/g, "\r\n")))].join("\r\n"),
    ...o.attachments.map((file) => {
      const name = path.basename(file);
      const fallback = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "");
      return [
        `Content-Type: application/pdf; name="${fallback}"`,
        `Content-Disposition: attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Content-Transfer-Encoding: base64",
        "",
        base64Lines(fs.readFileSync(file)),
      ].join("\r\n");
    }),
  ];
  return `${head.join("\r\n")}\r\n\r\n${parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("")}--${boundary}--\r\n`;
}

/** Puts a finished email into Gmail Drafts. The job seeker opens it in Gmail and presses Send. */
export async function createGmailDraft(o: { to: string; subject: string; body: string; attachments: string[] }): Promise<{ url: string }> {
  const s = getSettings();
  const raw = buildMime({ ...o, from: { name: s.name, address: s.gmailAddress }, messageId: `<${randomUUID()}@jobfinder.local>` });
  await withGmail(async (c) => {
    await c.append(await specialBox(c, "\\Drafts"), raw, ["\\Draft", "\\Seen"]);
  });
  return { url: gmailUrl(s.gmailAddress, "#drafts") };
}

/* ── reading ──────────────────────────────────────────── */

export type RawMail = { id: string; from: string; fromAddress: string; to: string[]; subject: string; date: string; source: string };

const addr = (a?: { name?: string; address?: string }) => (a ? (a.name ? `${a.name} <${a.address ?? ""}>` : a.address ?? "") : "");

async function fetchFrom(c: ImapFlow, box: string, query: Record<string, unknown>, limit: number): Promise<RawMail[]> {
  const lock = await c.getMailboxLock(box);
  try {
    const uids = await c.search(query, { uid: true });
    if (!uids || !uids.length) return [];
    const out: RawMail[] = [];
    for await (const m of c.fetch(uids.slice(-limit), { envelope: true, source: true }, { uid: true })) {
      const e = m.envelope;
      out.push({
        id: e?.messageId ?? `uid:${box}:${m.uid}`,
        from: addr(e?.from?.[0]),
        fromAddress: (e?.from?.[0]?.address ?? "").toLowerCase(),
        to: [...(e?.to ?? []), ...(e?.cc ?? [])].map((a) => (a.address ?? "").toLowerCase()).filter(Boolean),
        subject: e?.subject ?? "",
        date: new Date(e?.date ?? Date.now()).toISOString(),
        // raw bytes as latin1: the MIME parser decodes charsets itself
        source: m.source?.toString("latin1") ?? "",
      });
    }
    return out;
  } finally {
    lock.release();
  }
}

/** Emails with this Gmail label from the last `days` days. */
export async function readLabel(label: string, days: number): Promise<RawMail[]> {
  return withGmail(async (c) => {
    const exists = (await c.list()).some((b) => b.path === label || b.name === label);
    if (!exists) throw new Error(`No label called "${label}" in Gmail`);
    return fetchFrom(c, label, { since: new Date(Date.now() - days * 86_400_000) }, 300);
  });
}

/** Mail to or from these addresses / domains in the last `days` days, sent and received, from All Mail. */
export async function readConversations(terms: string[], days: number): Promise<RawMail[]> {
  if (!terms.length) return [];
  return withGmail(async (c) => {
    const all = await specialBox(c, "\\All");
    const out: RawMail[] = [];
    // Gmail search: {a b} means a OR b; batches keep each query short
    for (let i = 0; i < terms.length; i += 15) {
      const batch = terms.slice(i, i + 15).flatMap((t) => [`from:${t}`, `to:${t}`]).join(" ");
      out.push(...(await fetchFrom(c, all, { gmraw: `newer_than:${days}d -in:drafts {${batch}}` }, 200)));
    }
    return out;
  });
}
