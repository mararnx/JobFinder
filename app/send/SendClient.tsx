"use client";

import { ArrowLeft, Check, Copy, Download, ExternalLink, FileText, Globe, LoaderCircle, Mail, Send, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { act, toast } from "@/lib/client";
import { timeAgo } from "@/lib/ui";
import { Tile } from "../_components/ui";

export type SendItem = {
  jobId: number; appId: number; title: string; company: string; location: string | null; dream: boolean; language: string;
  url: string | null; applyEmail: string | null; subject: string; letter: string; emailBody: string;
  answers: { salary: string; start_date: string; notice_period: string; why_us: string; recipient?: string | null };
  approvedAt: string | null; hasPdf: boolean; bundleName: string | null;
};
type Me = { name: string; email: string; phone: string; salary: string; start: string; notice: string };
type Channel = "email" | "form";

const defaultChannel = (i: SendItem): Channel => (i.applyEmail || !i.url ? "email" : "form");

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    toast("Couldn't copy – select the text instead", undefined, "error");
  }
}

export function SendClient({ items, initialJob, me, gmail }: { items: SendItem[]; initialJob: number | null; me: Me; gmail: string }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(initialJob && items.some((i) => i.jobId === initialJob) ? initialJob : items[0].jobId);
  const item = items.find((i) => i.jobId === jobId) ?? items[0];
  const [channel, setChannel] = useState<Channel>(defaultChannel(item));
  const [to, setTo] = useState(item.applyEmail ?? "");
  const [opened, setOpened] = useState<Channel | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setChannel(defaultChannel(item));
    setTo(item.applyEmail ?? "");
    setOpened(null);
  }, [item]);

  const pos = items.findIndex((i) => i.jobId === item.jobId);
  const go = useCallback((d: number) => setJobId(items[(pos + d + items.length) % items.length].jobId), [items, pos]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    } finally {
      setBusy(null);
    }
  };

  const saveTo = () => run("to", async () => {
    if (to.trim() === (item.applyEmail ?? "")) return;
    await act("setApplyEmail", { jobId: item.jobId, email: to.trim() });
    router.refresh();
  });

  const openMail = () => run("mail", async () => {
    if (!to.trim()) throw new Error("Add the email address first");
    if (to.trim() !== (item.applyEmail ?? "")) await act("setApplyEmail", { jobId: item.jobId, email: to.trim() });
    const r = await act<{ ok: boolean; message: string }>("mailDraft", { jobId: item.jobId });
    if (!r.ok) throw new Error(r.message);
    setOpened("email");
    toast(r.message);
  });

  const openForm = () => run("form", async () => {
    toast("Opening the form in Chrome…");
    const r = await act<{ ok: boolean; message: string }>("openForm", { jobId: item.jobId });
    if (!r.ok) throw new Error(r.message);
    setOpened("form");
    toast(r.message);
  });

  const markSent = useCallback(() => run("sent", async () => {
    await act("markSent", { jobId: item.jobId, channel });
    toast(`Sent to ${item.company} – good luck!`);
    const next = items.find((i) => i.jobId !== item.jobId);
    if (next) setJobId(next.jobId);
    router.refresh();
  }), [item, channel, items, router]);

  const backToReview = () => run("back", async () => {
    await act("unapprove", { jobId: item.jobId });
    router.push(`/review?job=${item.jobId}`);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !document.querySelector(".palette.show, .drawer.show")) {
        e.preventDefault();
        void markSent();
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest?.("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".palette.show, .drawer.show")) return;
      const k = e.key.toLowerCase();
      if (k === "j") go(1);
      if (k === "k") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, markSent]);

  const answers: [string, string][] = [
    ["Name", me.name], ["Email", me.email], ["Phone", me.phone],
    ["Salary expectation", item.answers.salary || me.salary], ["Earliest start", item.answers.start_date || me.start],
    ["Notice period", item.answers.notice_period || me.notice], ["Why us", item.answers.why_us],
  ].filter((x): x is [string, string] => !!x[1]);

  return (
    <div className="send">
      <aside className="send-list" aria-label="Approved applications">
        {items.map((i) => (
          <button key={i.jobId} className="send-row" aria-current={i.jobId === item.jobId} onClick={() => setJobId(i.jobId)}>
            <Tile name={i.company} small />
            <span className="sr-text"><span className="t">{i.title}</span><span className="c">{i.company}</span></span>
            <span className="tag">{i.applyEmail ? <Mail /> : i.url ? <Globe /> : <FileText />}</span>
          </button>
        ))}
      </aside>

      <section className="send-main enter" key={item.jobId}>
        <header className="send-head">
          <Tile name={item.company} />
          <div style={{ minWidth: 0 }}>
            <h2>{item.title}</h2>
            <div className="faint">{item.company}{item.location ? ` · ${item.location}` : ""} · approved {timeAgo(item.approvedAt)}</div>
          </div>
          <div className="facts">
            {item.dream && <span className="tag warn"><Star />Dream job</span>}
            <span className="tag">{item.language.toUpperCase()}</span>
            {item.url && <a className="tag" href={item.url} target="_blank" rel="noreferrer"><ExternalLink />Ad</a>}
          </div>
        </header>

        <ol className="send-steps" aria-label="Steps">
          <li className={opened ? "done" : "on"}><span>1</span>Send it</li>
          <li className={opened ? "on" : ""}><span>2</span>Mark as sent</li>
        </ol>

        <div className="seg send-seg" role="tablist" aria-label="How to apply">
          <button role="tab" aria-selected={channel === "email"} aria-pressed={channel === "email"} onClick={() => setChannel("email")}><Mail />By email{!item.applyEmail && <small>no address in the ad</small>}</button>
          <button role="tab" aria-selected={channel === "form"} aria-pressed={channel === "form"} onClick={() => setChannel("form")} disabled={!item.url}><Globe />Online form{!item.url && <small>no link</small>}</button>
        </div>

        {channel === "email" ? (
          <div className="send-panel">
            <label className="fld"><span>To</span>
              <input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} onBlur={saveTo} placeholder="jobs@company.com" aria-label="Recipient email" />
            </label>
            <div className="mail-preview">
              <div className="subj">{item.subject}</div>
              <div className="letter-text">{item.emailBody}</div>
              {item.bundleName && <div className="attach"><FileText />{item.bundleName}</div>}
            </div>
            <div className="send-actions">
              {gmail
                ? <button className="btn primary" onClick={openMail} disabled={busy === "mail"}>{busy === "mail" ? <LoaderCircle className="spin-icon" /> : <Mail />}Create draft in Gmail</button>
                : <Link className="btn primary" href="/sources#gmail"><Mail />Connect Gmail</Link>}
              <button className="btn ghost" onClick={() => copy(`${item.subject}\n\n${item.emailBody}`, "Email text")}><Copy />Copy text</button>
              {item.hasPdf && <a className="btn ghost" href={`/api/file?app=${item.appId}&download=1`}><Download />PDF</a>}
            </div>
            <p className="faint send-hint">{gmail
              ? <>The finished email with the PDF attached lands in your Gmail drafts and Gmail opens – you press Send there. Once it&apos;s sent, JobFinder notices and moves it to Applied.</>
              : <>Connect Gmail once and every application lands in your drafts with the PDF attached. Until then: copy the text and attach the PDF yourself.</>}</p>
          </div>
        ) : (
          <div className="send-panel">
            <div className="form-url"><Globe /><a href={item.url ?? "#"} target="_blank" rel="noreferrer">{item.url}</a></div>
            <div className="send-actions">
              <button className="btn primary" onClick={openForm} disabled={busy === "form"}>{busy === "form" ? <LoaderCircle className="spin-icon" /> : <Globe />}Fill form in Chrome</button>
              {item.hasPdf && <>
                <a className="btn ghost" href={`/api/file?app=${item.appId}&download=1`}><Download />All in one PDF</a>
                <a className="btn ghost" href={`/api/file?app=${item.appId}&part=letter&download=1`}><Download />Cover letter</a>
                <a className="btn ghost" href={`/api/file?app=${item.appId}&part=cv&download=1`}><Download />CV</a>
              </>}
            </div>
            <p className="faint send-hint">Chrome opens the form, fills in your details and attaches the PDFs. Check everything and submit it yourself – JobFinder never submits.</p>
            <h4>Answers for the form</h4>
            <ul className="answers">
              {answers.map(([k, v]) => (
                <li key={k}><span className="k">{k}</span><span className="v">{v}</span><button className="icon-btn" onClick={() => copy(v, k)} aria-label={`Copy ${k}`}><Copy /></button></li>
              ))}
              <li><span className="k">Cover letter</span><span className="v faint">{item.letter.slice(0, 90)}…</span><button className="icon-btn" onClick={() => copy(item.letter, "Cover letter")} aria-label="Copy cover letter"><Copy /></button></li>
            </ul>
          </div>
        )}

        <footer className="review-foot">
          <button className="btn ghost" onClick={backToReview} disabled={busy === "back"}><ArrowLeft />Back to review</button>
          <div className="grow" />
          {opened && <span className="faint" style={{ fontSize: 13 }}>Sent it?</span>}
          <button className={`btn${opened ? " primary" : ""}`} onClick={markSent} disabled={busy === "sent"}>{busy === "sent" ? <LoaderCircle className="spin-icon" /> : opened ? <Send /> : <Check />}Mark as sent <kbd>⌘↵</kbd></button>
        </footer>
      </section>
    </div>
  );
}
