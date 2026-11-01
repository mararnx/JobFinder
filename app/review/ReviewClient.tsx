"use client";

import { Ban, Check, CircleAlert, CircleCheck, CircleDot, Circle, CircleX, ExternalLink, FileText, Info, LoaderCircle, Mail, MousePointerClick, Pencil, ShieldCheck, ShieldAlert, Star, WandSparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { act, toast } from "@/lib/client";
import { Tile } from "../_components/ui";

type Claim = { text: string; status: "ok" | "reworded" | "unsupported"; fact_id?: string | null; note: string };
export type ReviewItem = {
  jobId: number; appId: number; title: string; company: string; location: string | null; dream: boolean; language: string; url: string | null;
  channel: "email" | "form" | "none"; applyEmail: string | null; version: number; subject: string; letter: string; emailBody: string; status: string;
  coverage: { requirement: string; status: "covered" | "partial" | "missing"; where: string }[]; claims: Claim[];
  answers: { salary: string; start_date: string; notice_period: string; why_us: string; recipient?: string | null }; hasPdf: boolean; createdAt: string;
};

function highlight(letter: string, claims: Claim[]) {
  type Part = { text: string; claim?: Claim };
  let parts: Part[] = [{ text: letter }];
  for (const c of claims) {
    const needle = c.text.trim();
    if (needle.length < 8) continue;
    parts = parts.flatMap((p) => {
      if (p.claim) return [p];
      const i = p.text.indexOf(needle);
      if (i < 0) return [p];
      return [{ text: p.text.slice(0, i) }, { text: needle, claim: c }, { text: p.text.slice(i + needle.length) }];
    });
  }
  return parts;
}

export function ReviewClient({ items, initialJob, profile }: { items: ReviewItem[]; initialJob: number | null; profile: { salary: string; start: string; notice: string } }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<number>(initialJob && items.some((i) => i.jobId === initialJob) ? initialJob : items[0].jobId);
  const item = items.find((i) => i.jobId === jobId) ?? items[0];
  const [tab, setTab] = useState<"letter" | "pdf" | "email">("letter");
  const [draft, setDraft] = useState(item.letter);
  const [subject, setSubject] = useState(item.subject);
  const [emailBody, setEmailBody] = useState(item.emailBody);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const editor = useRef<HTMLTextAreaElement>(null);
  const saved = useRef({ appId: item.appId, letter: item.letter, subject: item.subject, emailBody: item.emailBody });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [details, setDetails] = useState(item.answers);
  const [rewrite, setRewrite] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [warned, setWarned] = useState(false);
  const shownAt = useRef(Date.now());

  // a new draft (another job, or a rewrite = new version) resets the editor; saves of the same draft don't
  useEffect(() => {
    setDraft(item.letter);
    setSubject(item.subject);
    setEmailBody(item.emailBody);
    setDetails(item.answers);
    saved.current = { appId: item.appId, letter: item.letter, subject: item.subject, emailBody: item.emailBody };
    setSaveState("idle");
    setRewrite(null);
    setWarned(false);
    setTab("letter");
    shownAt.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.appId]);

  const counts = useMemo(() => ({
    ok: item.claims.filter((c) => c.status === "ok").length,
    reworded: item.claims.filter((c) => c.status === "reworded").length,
    unsupported: item.claims.filter((c) => c.status === "unsupported").length,
  }), [item.claims]);
  const pos = items.findIndex((i) => i.jobId === item.jobId);


  /** Saves the text if it changed since the last save. The server rebuilds the PDF when letter or subject changed. */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const now = { appId: item.appId, letter: draft, subject, emailBody };
    const last = saved.current;
    if (last.appId !== now.appId || (last.letter === now.letter && last.subject === now.subject && last.emailBody === now.emailBody)) return;
    setSaveState("saving");
    try {
      await act("saveLetter", { appId: now.appId, letter: now.letter, subject: now.subject, emailBody: now.emailBody });
      saved.current = now;
      setSaveState("saved");
      router.refresh();
    } catch (e) {
      setSaveState("dirty");
      toast((e as Error).message, undefined, "error");
    }
  }, [item.appId, draft, subject, emailBody, router]);

  const go = useCallback((delta: number) => {
    const n = items[(pos + delta + items.length) % items.length];
    void flush();
    if (n) setJobId(n.jobId);
  }, [items, pos, flush]);

  // autosave 1.2 s after the last keystroke
  useEffect(() => {
    const last = saved.current;
    if (last.appId !== item.appId || (last.letter === draft && last.subject === subject && last.emailBody === emailBody)) return;
    setSaveState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [draft, subject, emailBody, item.appId, flush]);

  // grow the editor with its text, so the page scrolls instead of the textarea
  useEffect(() => {
    const t = editor.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  }, [draft, tab]);

  const approve = useCallback(async () => {
    if (counts.unsupported && !warned) {
      setWarned(true);
      return;
    }
    setBusy("approve");
    try {
      await flush();
      await act("approve", { appId: item.appId, seconds: (Date.now() - shownAt.current) / 1000 });
      const done = item;
      toast(`${done.company} is ready to send`, async () => {
        await act("unapprove", { jobId: done.jobId });
        setJobId(done.jobId);
        router.refresh();
      });
      const next = items.find((i) => i.jobId !== done.jobId);
      if (next) setJobId(next.jobId);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    } finally {
      setBusy(null);
    }
  }, [counts.unsupported, warned, flush, item, items, router]);

  const discard = async () => {
    setBusy("discard");
    try {
      const r = await act<{ prev: string }>("move", { jobId: item.jobId, to: "closed", closedReason: "not applying" });
      const done = item;
      toast(`Not applying to ${done.company}`, async () => {
        await act("move", { jobId: done.jobId, to: r.prev });
        router.refresh();
      });
      const next = items.find((i) => i.jobId !== done.jobId);
      if (next) setJobId(next.jobId);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const saveDetail = async (key: keyof ReviewItem["answers"]) => {
    if ((details[key] ?? "") === (item.answers[key] ?? "")) return;
    try {
      await act("saveAnswers", { appId: item.appId, [key]: details[key] ?? "" });
      toast(key === "recipient" ? "Saved · letter head updated" : "Saved");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    }
  };

  /** Selects the claim in the editor so it can be retyped right away. */
  const selectClaim = (text: string) => {
    setTab("letter");
    requestAnimationFrame(() => {
      const t = editor.current;
      const i = t?.value.indexOf(text.trim()) ?? -1;
      if (!t || i < 0) return t?.focus();
      t.focus();
      t.setSelectionRange(i, i + text.trim().length);
      document.querySelectorAll<HTMLElement>(".editor-bg .claim.bad").forEach((el) => el.textContent === text.trim() && el.scrollIntoView({ block: "center", behavior: "smooth" }));
    });
  };

  const showClaim = (text: string) => {
    setTab("letter");
    requestAnimationFrame(() => {
      const el = [...document.querySelectorAll<HTMLElement>(".editor-bg .claim.bad")].find((x) => x.textContent === text.trim());
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    });
  };

  const doRewrite = async (instruction = rewrite ?? "") => {
    setBusy("rewrite");
    try {
      await act("regenerate", { jobId: item.jobId, instruction });
      toast("Claude is rewriting – it comes back here when done");
      setRewrite(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !document.querySelector(".palette.show")) {
        e.preventDefault();
        void approve();
        return;
      }
      if (t.closest?.("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".palette.show, .drawer.show")) return;
      const k = e.key.toLowerCase();
      if (k === "j") go(1);
      if (k === "k") go(-1);
      if (k === "e") { e.preventDefault(); setTab("letter"); requestAnimationFrame(() => editor.current?.focus()); }
      if (k === "r") { e.preventDefault(); setRewrite(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const parts = highlight(draft, item.claims);
  const words = draft.split(/\s+/).filter(Boolean).length;
  const covered = item.coverage.filter((c) => c.status !== "missing").length;
  const unsupported = item.claims.filter((c) => c.status === "unsupported");
  const missingDetails = [["salary", details.salary || profile.salary], ["start date", details.start_date || profile.start], ["notice period", details.notice_period || profile.notice]].filter(([, v]) => !v).map(([k]) => k);
  type CheckItem = { tone: "ok" | "warn" | "bad"; title: string; sub?: string; action?: { label: string; run: () => void } };
  const checks: CheckItem[] = [
    unsupported.length
      ? { tone: "bad", title: `${unsupported.length} claim${unsupported.length > 1 ? "s" : ""} not backed by your CV`, sub: "Fix or remove before sending", action: { label: "Show", run: () => showClaim(unsupported[0].text) } }
      : { tone: "ok", title: "Every claim is backed by your CV" },
    item.coverage.length
      ? { tone: covered === item.coverage.length ? "ok" : covered >= item.coverage.length / 2 ? "warn" : "bad", title: `${covered} of ${item.coverage.length} requirements addressed`, sub: covered < item.coverage.length ? "Missing ones are fine if you simply don't have them" : undefined }
      : { tone: "warn", title: "No requirements found in the ad" },
    missingDetails.length ? { tone: "warn", title: `Missing: ${missingDetails.join(", ")}`, sub: "Many forms ask for these – fill them in below" } : { tone: "ok", title: "Salary, start date and notice period set" },
    details.recipient ? { tone: "ok", title: `Addressed to ${details.recipient}` } : { tone: "warn", title: "No contact person – generic greeting", sub: "Add a name below if the ad mentions one" },
    { tone: words < 150 || words > 420 ? "warn" : "ok", title: `${words} words`, sub: words > 420 ? "Long – recruiters skim; aim for 200–350" : words < 150 ? "Short – may feel generic" : undefined },
    item.channel === "none" ? { tone: "bad", title: "No email or link to apply", sub: "Add an address on the next step, or send the PDF yourself" } : { tone: "ok", title: item.channel === "email" ? `Goes by email to ${item.applyEmail}` : "Goes through the company's online form" },
    item.hasPdf ? { tone: "ok", title: "PDF with letter, CV and attachments ready" } : { tone: "bad", title: "PDF missing", sub: "Save the letter once to rebuild it" },
  ];
  const blocking = checks.filter((c) => c.tone === "bad").length;
  // only what needs attention is spelled out; passed checks fold into one line
  const passed = checks.filter((c) => c.tone === "ok");
  const checkRow = (c: CheckItem) => (
    <li key={c.title} className={c.tone}>
      {c.tone === "ok" ? <CircleCheck /> : c.tone === "warn" ? <CircleAlert /> : <CircleX />}
      <div>{c.title}{c.sub && <small>{c.sub}</small>}</div>
      {c.action && <button className="link" onClick={c.action.run}>{c.action.label}</button>}
    </li>
  );

  return (
    <div className="review">
      <section className="ad-pane enter">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Tile name={item.company} />
          <div><div style={{ fontWeight: 500 }}>{item.company}</div><div className="faint" style={{ fontSize: 12 }}>{item.location ?? ""} · draft v{item.version}</div></div>
          <div className="pager">
            <button className="icon-btn" onClick={() => go(-1)} aria-label="Previous draft">‹</button>
            <span className="tag">{pos + 1} of {items.length}</span>
            <button className="icon-btn" onClick={() => go(1)} aria-label="Next draft">›</button>
          </div>
        </div>
        <h2>{item.title}</h2>
        <div className="facts" style={{ margin: "10px 0 0" }}>
          {item.channel === "email" ? <span className="tag accent"><Mail />Apply by email</span> : item.channel === "form" ? <span className="tag accent"><MousePointerClick />Online form</span> : <span className="tag warn"><Info />No apply route found</span>}
          <span className="tag">{item.language.toUpperCase()}</span>
          {item.dream && <span className="tag warn"><Star />Dream job</span>}
          {item.url && <a className="tag" href={item.url} target="_blank" rel="noreferrer"><ExternalLink />Ad</a>}
        </div>
        <h4>Before you send</h4>
        <ul className="checklist" aria-label="Checklist">
          {checks.filter((c) => c.tone !== "ok").map(checkRow)}
          {passed.length > 0 && (
            <li className="ok passed">
              <details>
                <summary><CircleCheck />{passed.length === checks.length ? "All checks passed" : `${passed.length} more check${passed.length > 1 ? "s" : ""} passed`}</summary>
                <ul className="checklist">{passed.map(checkRow)}</ul>
              </details>
            </li>
          )}
        </ul>
        {unsupported.length > 0 && (
          <>
            <h4>Not backed by your CV</h4>
            <ul className="claims-list">
              {unsupported.map((c) => (
                <li key={c.text}>
                  <q>{c.text}</q>
                  <span className="note">{c.note}</span>
                  <div className="row">
                    <button className="btn ghost sm" onClick={() => showClaim(c.text)}>Show in letter</button>
                    <button className="btn ghost sm" onClick={() => selectClaim(c.text)}><Pencil />Edit</button>
                    <button className="btn ghost sm" onClick={() => void doRewrite(`Remove this claim, it is not in my CV: "${c.text}"`)} disabled={busy === "rewrite"}><WandSparkles />Rewrite without it</button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <h4>Requirements from the ad</h4>
        <ul className="req">
          {item.coverage.length ? item.coverage.map((c) => (
            <li key={c.requirement} className={c.status}>
              {c.status === "covered" ? <CircleCheck /> : c.status === "partial" ? <CircleDot /> : <Circle />}{c.requirement}<span className="s">{c.where}</span>
            </li>
          )) : <li className="faint">No requirements extracted</li>}
        </ul>
        <h4>Required details</h4>
        <div className="fields">
          {([["salary", "Salary expectation", profile.salary], ["start_date", "Earliest start", profile.start], ["notice_period", "Notice period", profile.notice], ["recipient", "Contact person", "e.g. Ms Jansen"]] as const).map(([k, label, ph]) => (
            <label key={k} className="field"><span className="faint" style={{ display: "block", fontSize: 11, marginBottom: 2 }}>{label}</span>
              <input value={details[k] ?? ""} placeholder={ph || "—"} onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))} onBlur={() => void saveDetail(k)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            </label>
          ))}
        </div>
        {item.answers.why_us && <><h4>“Why us” answer for forms</h4><p className="muted" style={{ fontSize: 13, margin: 0 }}>{item.answers.why_us}</p></>}
      </section>

      <section className="letter-pane">
        <div className="letter-tools">
          <div className="seg" role="group" aria-label="Document">
            <button aria-pressed={tab === "letter"} onClick={() => setTab("letter")}>Cover letter</button>
            <button aria-pressed={tab === "pdf"} onClick={() => setTab("pdf")}>PDF</button>
            <button aria-pressed={tab === "email"} onClick={() => setTab("email")}>Email</button>
          </div>
          <span className="letter-meta" style={{ marginLeft: "auto" }}>{words} words · ~{Math.max(1, Math.round(words / 200))} min read</span>
          <span className="tag ok"><ShieldCheck />{counts.ok} backed</span>
          {counts.reworded > 0 && <span className="tag warn"><Info />{counts.reworded} reworded</span>}
          {counts.unsupported > 0 && <button className="tag bad" onClick={() => showClaim(unsupported[0].text)}><ShieldAlert />{counts.unsupported} unsupported</button>}
          <span className={`save-state ${saveState}`} aria-live="polite">{saveState === "saving" ? <><LoaderCircle className="spin-icon" />Saving…</> : saveState === "saved" ? <><Check />Saved · PDF updated</> : saveState === "dirty" ? "Editing…" : <><Pencil />Click the text to edit</>}</span>
        </div>
        <div className="letter-scroll">
          {tab === "letter" && (
            <div className="paper">
              <input className="subj-edit" value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => void flush()} aria-label="Subject" />
              <div className="editor">
                <div className="editor-bg letter-text" aria-hidden="true">
                  {parts.map((p, i) => p.claim ? (
                    <mark key={i} className={`claim ${p.claim.status === "ok" ? "ok" : p.claim.status === "reworded" ? "warn" : "bad"}`}>{p.text}</mark>
                  ) : <span key={i}>{p.text}</span>)}
                  {"\n"}
                </div>
                <textarea ref={editor} className="letter-edit" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => void flush()} aria-label="Cover letter" spellCheck />
              </div>
            </div>
          )}
          {tab === "pdf" && (item.hasPdf ? <iframe className="pdf-frame" src={`/api/file?app=${item.appId}#view=FitH`} title="Application PDF" /> : <p className="muted">No PDF yet.</p>)}
          {tab === "email" && (
            <div className="paper">
              <div className="addr">To: {item.applyEmail ?? "(no email in the ad)"}</div>
              <div className="subj">{subject}</div>
              <textarea className="letter-edit email-edit" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} onBlur={() => void flush()} aria-label="Email text" rows={10} spellCheck />
              <div className="addr" style={{ marginTop: 20 }}><FileText style={{ verticalAlign: "-3px" }} /> PDF attached</div>
            </div>
          )}
        </div>
        {rewrite !== null && (
          <form className="rewrite-bar" onSubmit={(e) => { e.preventDefault(); void doRewrite(); }}>
            <WandSparkles />
            <input className="input" autoFocus value={rewrite} onChange={(e) => setRewrite(e.target.value)} placeholder="What should change? e.g. shorter, more about the data work, warmer opening" onKeyDown={(e) => e.key === "Escape" && setRewrite(null)} />
            <button className="btn primary" type="submit" disabled={busy === "rewrite"}>{busy === "rewrite" ? <LoaderCircle className="spin-icon" /> : <WandSparkles />}Rewrite</button>
            <button className="icon-btn" type="button" onClick={() => setRewrite(null)} aria-label="Cancel"><X /></button>
          </form>
        )}
        {warned && (
          <div className="warn-bar" role="alert"><ShieldAlert />{counts.unsupported} claim{counts.unsupported > 1 ? "s are" : " is"} not backed by your CV (marked red). Edit {counts.unsupported > 1 ? "them" : "it"}, rewrite, or approve anyway.</div>
        )}
        <div className="review-foot">
          {item.hasPdf && <a className="file" href={`/api/file?app=${item.appId}`} target="_blank" rel="noreferrer"><FileText />Application PDF</a>}
          <div className="grow" />
          <button className="btn ghost" onClick={discard} disabled={busy === "discard"}><Ban />Don&apos;t apply</button>
          <button className="btn ghost" onClick={() => setRewrite("")}><WandSparkles />Rewrite <kbd>R</kbd></button>
          <button className="btn primary" onClick={approve} disabled={busy === "approve"} title="Approve – then choose email or form on the next step">
            {busy === "approve" ? <LoaderCircle className="spin-icon" /> : <Check />}{warned ? "Approve anyway" : blocking ? `Approve (${blocking} to check)` : "Approve"} <kbd>⌘↵</kbd>
          </button>
        </div>
      </section>
    </div>
  );
}
