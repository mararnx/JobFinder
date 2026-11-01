"use client";

import { Check, ExternalLink, LoaderCircle, Mail, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { act, toast } from "@/lib/client";
import { timeAgo } from "@/lib/ui";
import "./more-sources.css";

export type GmailProps = { address: string; suggested: string; lastCheck: string | null };

/** Connect Gmail with an app password: drafts with the PDF, job alerts, and sent / reply tracking. */
export function GmailCard({ address, suggested, lastCheck }: GmailProps) {
  const router = useRouter();
  const [email, setEmail] = useState(suggested);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const go = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    } finally {
      setBusy(null);
    }
  };

  if (address) {
    return (
      <div className="card col-12 gmail" id="gmail">
        <div className="card-h"><Mail />Gmail<span className="tag ok right"><Check />Connected</span></div>
        <div className="gmail-on">
          <div className="grow">
            <b>{address}</b>
            <span className="faint">Applications go to your Gmail drafts with the PDF attached. JobFinder checks every 30 minutes: sent emails move the job to Applied, replies move it on (interview → In contact, rejection → closed).{lastCheck ? ` Last check ${timeAgo(lastCheck)}.` : ""}</span>
          </div>
          <button className="btn sm" onClick={() => go("sync", async () => { await act("gmailSync"); toast("Checking Gmail now"); })} disabled={busy === "sync"}>{busy === "sync" ? <LoaderCircle className="spin-icon" /> : <RefreshCw />}Check now</button>
          <button className="btn ghost sm" onClick={() => confirm(`Disconnect ${address}? The app password is removed from this Mac.`) && go("off", async () => { await act("gmailDisconnect"); toast("Gmail disconnected"); })} disabled={busy === "off"}><Unplug />Disconnect</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card col-12 gmail" id="gmail">
      <div className="card-h"><Mail />Connect Gmail <span className="tag accent">needed to send by email</span></div>
      <p className="gmail-intro faint">JobFinder puts each application into your Gmail drafts with the PDF attached – you press Send. It also reads your job alerts and notices sent emails and company replies, so the Pipeline keeps itself up to date. It uses an <b>app password</b>: a separate 16-letter password just for JobFinder, kept in this Mac&apos;s Keychain. You can delete it any time in your Google account.</p>
      <ol className="ms-steps gmail-steps">
        <li><b>Turn on 2-Step Verification</b> in your Google account, if it isn&apos;t on yet. <a href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noreferrer">Open it<ExternalLink /></a></li>
        <li><b>Create an app password</b> called “JobFinder” and copy the 16 letters Google shows. <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">Open app passwords<ExternalLink /></a></li>
        <li>
          <b>Paste it here.</b>
          <form className="gmail-form" onSubmit={(e) => { e.preventDefault(); void go("connect", async () => { const r = await act<{ message: string }>("gmailConnect", { address: email, password: pw }); setPw(""); toast(r.message); }); }}>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" aria-label="Gmail address" autoComplete="email" />
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="abcd efgh ijkl mnop" aria-label="App password" autoComplete="off" />
            <button className="btn primary" type="submit" disabled={busy === "connect" || !email.trim() || !pw.trim()}>{busy === "connect" ? <LoaderCircle className="spin-icon" /> : <Check />}Connect</button>
          </form>
        </li>
      </ol>
    </div>
  );
}
