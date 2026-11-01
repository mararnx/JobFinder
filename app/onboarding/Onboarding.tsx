"use client";

import { ArrowLeft, ArrowRight, Bot, Check, CircleCheck, Compass, LoaderCircle, Plus, Sparkles, ThumbsDown, ThumbsUp, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Settings } from "@/lib/db";
import { act, toast } from "@/lib/client";
import { SettingsForm } from "../_components/SettingsForm";

type Ex = { text: string; reason: string };
const STEPS = ["Welcome", "Documents", "About you", "Search", "Examples", "Done"];

export function Onboarding({ settings, docs, profiles, claude }: { settings: Settings; docs: { id: number; kind: string; name: string; status: string; note: string | null }[]; profiles: { id: number; name: string; keywords: string[]; location: string; radius_km: number }[]; claude: { cli: string | null; mock: boolean } }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [liked, setLiked] = useState<Ex[]>([{ text: "", reason: "" }, { text: "", reason: "" }, { text: "", reason: "" }]);
  const [disliked, setDisliked] = useState<Ex[]>([{ text: "", reason: "" }, { text: "", reason: "" }]);
  const [kw, setKw] = useState(profiles[0]?.keywords.join(", ") ?? "");
  const [loc, setLoc] = useState(profiles[0]?.location ?? settings.home);
  const [radius, setRadius] = useState(profiles[0]?.radius_km ?? 30);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const upload = async (files: FileList) => {
    const fd = new FormData();
    [...files].forEach((f) => fd.append("files", f));
    setBusy(true);
    await fetch("/api/documents", { method: "POST", body: fd });
    setBusy(false);
    toast(`${files.length} file(s) added · reading`);
    router.refresh();
  };

  const saveSearch = async () => {
    try {
      await act("saveSearch", { id: profiles[0]?.id, name: "Main search", keywords: kw, location: loc, radius });
      setStep(4);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await act("finishOnboarding", { liked, disliked });
      setStep(5);
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    } finally {
      setBusy(false);
    }
  };

  const exList = (list: Ex[], set: (l: Ex[]) => void, kind: "like" | "dislike") => (
    <div className="ex-list">
      {list.map((x, i) => (
        <div className="ex" key={i}>
          <textarea className="input" rows={3} value={x.text} placeholder={kind === "like" ? "Paste the text of an ad you'd love (or at least title + key points)" : "Paste an ad you'd never take"} onChange={(e) => set(list.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} />
          <input className="input" value={x.reason} placeholder={kind === "like" ? "Why? e.g. product ownership, climate tech, 3 days remote" : "Why not? e.g. agency, too junior, sales-heavy"} onChange={(e) => set(list.map((y, j) => (j === i ? { ...y, reason: e.target.value } : y)))} />
          {list.length > 1 && <button className="icon-btn" aria-label="Remove" onClick={() => set(list.filter((_, j) => j !== i))}><Trash2 /></button>}
        </div>
      ))}
      <button className="btn ghost sm" onClick={() => set([...list, { text: "", reason: "" }])}><Plus />Add another</button>
    </div>
  );

  const cv = docs.find((d) => d.kind === "cv");

  return (
    <div className="view-inner onboarding enter">
      <ol className="stepper" aria-label="Setup steps">
        {STEPS.map((s, i) => <li key={s} className={i === step ? "on" : i < step ? "done" : ""}><span className="mono">{i < step ? "✓" : i + 1}</span>{s}</li>)}
      </ol>

      {step === 0 && (
        <section className="ob-card card">
          <div className="brand-mark big"><Compass /></div>
          <h1 className="serif">Welcome to Kompass.</h1>
          <p>Kompass searches German job sources for you, ranks every ad by how well it fits, and writes tailored applications you approve with one click. Everything stays on this Mac.</p>
          <div className={`claude-status ${claude.cli ? "ok" : "warn"}`}>
            <Bot />
            <div>{claude.cli ? <><b>Claude Code found ({claude.cli}).</b> AI runs on your Claude Max subscription.</> : <><b>Claude Code isn&apos;t installed yet.</b> You can set everything up now – AI answers are simulated until you install Claude Code and log in with the Max account (see SETUP.md).</>}</div>
          </div>
          <p className="faint">Setup takes about 10 minutes: your documents, a few details, what you&apos;re looking for, and some example ads.</p>
          <div className="ob-actions"><button className="btn primary lg" onClick={() => setStep(1)}>Let&apos;s go<ArrowRight /></button></div>
        </section>
      )}

      {step === 1 && (
        <section className="ob-card card">
          <h2>Your documents</h2>
          <p>Upload your CV (Word is best), 2–5 cover letters you wrote yourself, and your references and certificates. You can add more later under Documents.</p>
          <label className="drop" tabIndex={0} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files); }} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}>
            <input ref={input} type="file" multiple className="sr-only" accept=".pdf,.doc,.docx,.odt,.txt,.md,.png,.jpg,.jpeg" onChange={(e) => e.target.files && void upload(e.target.files)} />
            <span className="drop-ic">{busy ? <LoaderCircle className="spin-icon" /> : <Upload />}</span>
            <span className="drop-t">Drop files here or <u>browse</u></span>
            <span className="drop-s">The category is detected from the file name</span>
          </label>
          <ul className="list compact">
            {docs.map((d) => <li key={d.id}>{d.status === "reading" ? <LoaderCircle className="spin-icon" /> : <CircleCheck style={{ color: "var(--ok)" }} />}<div className="grow"><b>{d.name}</b><span className="faint">{d.kind} · {d.status === "reading" ? "reading…" : d.note}</span></div></li>)}
          </ul>
          {!cv && <p className="hint">Without a CV, Kompass can still find and rank jobs, but can&apos;t write applications.</p>}
          <div className="ob-actions"><button className="btn ghost" onClick={() => setStep(0)}><ArrowLeft />Back</button><button className="btn primary" onClick={() => setStep(2)}>{cv ? "Next" : "Skip for now"}<ArrowRight /></button></div>
        </section>
      )}

      {step === 2 && (
        <section className="ob-card card">
          <h2>About you</h2>
          <p>Used in letter heads and application forms, and as hard filters.</p>
          <SettingsForm initial={settings} sections={["personal", "application", "filters"]} submitLabel="Save and continue" onSaved={(saved) => { if (!loc && saved.home) setLoc(saved.home); setStep(3); }} />
          <div className="ob-actions"><button className="btn ghost" onClick={() => setStep(1)}><ArrowLeft />Back</button></div>
        </section>
      )}

      {step === 3 && (
        <section className="ob-card card">
          <h2>What are you looking for?</h2>
          <p>Keywords are searched one by one, like typing them into a job portal. Use the titles you&apos;d apply for, in German and English.</p>
          <div className="form-grid" style={{ padding: 0 }}>
            <label className="fld wide"><span>Job titles / keywords (comma-separated)</span><input className="input" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Product Owner, Produktmanager, Product Manager" /></label>
            <label className="fld"><span>City</span><input className="input" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="Hamburg (empty = all of Germany)" /></label>
            <label className="fld"><span>Radius (km)</span><input className="input" type="number" min={0} max={200} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></label>
          </div>
          <div className="ob-actions"><button className="btn ghost" onClick={() => setStep(2)}><ArrowLeft />Back</button><button className="btn primary" onClick={saveSearch} disabled={!kw.trim()}>Next<ArrowRight /></button></div>
        </section>
      )}

      {step === 4 && (
        <section className="ob-card card wide">
          <h2>Teach it your taste</h2>
          <p>Paste a few ads you&apos;d love and a few you&apos;d never take, with a short reason. This gives Kompass its first preference profile. It keeps learning from every decision after that. Optional, but it makes the first scores much better.</p>
          <h3><ThumbsUp style={{ color: "var(--ok)" }} />Ads you&apos;d love</h3>
          {exList(liked, setLiked, "like")}
          <h3><ThumbsDown style={{ color: "var(--danger)" }} />Ads you&apos;d never take</h3>
          {exList(disliked, setDisliked, "dislike")}
          <div className="ob-actions"><button className="btn ghost" onClick={() => setStep(3)}><ArrowLeft />Back</button><button className="btn primary lg" onClick={finish} disabled={busy}>{busy ? <><LoaderCircle className="spin-icon" />Writing your profile…</> : <><Sparkles />Finish setup</>}</button></div>
        </section>
      )}

      {step === 5 && (
        <section className="ob-card card">
          <div className="brand-mark big"><Check /></div>
          <h1 className="serif">You&apos;re set.</h1>
          <p>Kompass is fetching the first ads now. They show up in Discover within a few minutes, sorted by fit. Your preference profile is under Profile – read it and fix anything that&apos;s off.</p>
          <div className="ob-actions"><button className="btn primary lg" onClick={() => { router.push("/"); router.refresh(); }}>Open Kompass<ArrowRight /></button></div>
        </section>
      )}
    </div>
  );
}
