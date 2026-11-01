"use client";

import { Award, CircleAlert, Feather, File, FileBadge, FilePenLine, FileText, FileUser, Image as ImageIcon, ListChecks, LoaderCircle, Lock, Paperclip, Sparkles, Trash2, Upload, FileType } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { act, toast } from "@/lib/client";
import { Markdown } from "../_components/ui";

export type Doc = { id: number; kind: string; name: string; size: number; status: string; note: string | null; attach: number };

const KINDS = [
  { key: "cv", name: "CV / Résumé", icon: FileUser, hint: "Word file preferred – a tailored version is made for each job from it." },
  { key: "letter", name: "Past cover letters", icon: FilePenLine, hint: "3–5 letters you wrote. JobFinder learns your writing style from them." },
  { key: "ref", name: "References (Arbeitszeugnisse)", icon: FileBadge, hint: "Attached to the application PDF and used as evidence." },
  { key: "cert", name: "Certificates & degrees", icon: Award, hint: "University, vocational training, further education." },
  { key: "other", name: "Other", icon: File, hint: "Photo, work samples, recommendations." },
];

const fmt = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const icon = (n: string) => (/\.pdf$/i.test(n) ? FileText : /\.(png|jpe?g|heic|webp)$/i.test(n) ? ImageIcon : FileType);

export function DocumentsClient({ docs, facts, positions, style, letters, attachBytes }: { docs: Doc[]; facts: number; positions: number; style: string | null; letters: number; attachBytes: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [showStyle, setShowStyle] = useState(false);

  const upload = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    setUploading(list.length);
    const fd = new FormData();
    list.forEach((f) => fd.append("files", f));
    try {
      const r = await fetch("/api/documents", { method: "POST", body: fd });
      const body = (await r.json()) as { ids: number[]; skipped: string[] };
      toast(`${body.ids.length} ${body.ids.length === 1 ? "file" : "files"} added · reading${body.skipped.length ? ` · skipped ${body.skipped.join(", ")}` : ""}`);
      router.refresh();
    } catch {
      toast("Upload failed", undefined, "error");
    } finally {
      setUploading(0);
    }
  };

  const run = async (action: string, args: Record<string, unknown>, msg: string) => {
    try {
      await act(action, args);
      toast(msg);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    }
  };

  return (
    <div className="view-inner enter">
      <section className="hero" style={{ paddingBottom: 22 }}>
        <div className="date"><Lock />{docs.length} files · stored only on this Mac</div>
        <h1 style={{ fontSize: 44 }}>Documents</h1>
        <p>Everything that already exists: CV, old cover letters, references, certificates. JobFinder reads each file once and uses it for applications. It only claims what these documents back up.</p>
      </section>
      <div className="bento">
        <div className="col-8 docs-main">
          <label
            className={`drop${over ? " over" : ""}`}
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
            onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); }}
          >
            <input ref={input} type="file" multiple accept=".pdf,.doc,.docx,.odt,.txt,.md,.png,.jpg,.jpeg" className="sr-only" onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
            <span className="drop-ic">{uploading ? <LoaderCircle className="spin-icon" /> : <Upload />}</span>
            <span className="drop-t">{uploading ? `Uploading ${uploading}…` : <>Drop files here or <u>browse</u></>}</span>
            <span className="drop-s">PDF, Word, images · several at once · category detected from the file name</span>
          </label>
          {KINDS.map((k) => {
            const ds = docs.filter((d) => d.kind === k.key);
            const Icon = k.icon;
            return (
              <section key={k.key} className="card doc-group">
                <div className="card-h"><Icon />{k.name}<span className="badge">{ds.length}</span>
                  {!ds.length && (k.key === "cv" || k.key === "letter") && <span className="right tag warn"><CircleAlert />missing</span>}</div>
                <p className="doc-hint">{k.hint}</p>
                {ds.length > 0 && (
                  <ul className="doc-list">
                    {ds.map((d) => {
                      const FI = icon(d.name);
                      return (
                        <li key={d.id} className={`doc${d.status === "reading" ? " reading" : ""}`}>
                          <span className="doc-ic"><FI /></span>
                          <span className="grow">
                            <a className="t" href={`/api/file?doc=${d.id}`} target="_blank" rel="noreferrer">{d.name}</a>
                            <span className="m"><span className="mono">{fmt(d.size)}</span> · {d.status === "reading" ? <span className="reading-tag"><LoaderCircle className="spin-icon" />Claude reading…</span> : d.status === "error" ? <span style={{ color: "var(--danger)" }}>Could not read: {d.note}</span> : <><span style={{ color: "var(--ok)" }}>✓</span> {d.note}</>}</span>
                          </span>
                          {(d.kind === "ref" || d.kind === "cert") && /\.pdf$/i.test(d.name) && (
                            <label className="attach-toggle" title="Attach to every application PDF"><input type="checkbox" checked={!!d.attach} onChange={(e) => run("docAttach", { docId: d.id, attach: e.target.checked }, e.target.checked ? "Will be attached" : "Not attached anymore")} /><Paperclip /></label>
                          )}
                          <select className="kind-sel" value={d.kind} aria-label={`Category for ${d.name}`} onChange={(e) => run("docKind", { docId: d.id, kind: e.target.value }, `Moved to “${KINDS.find((x) => x.key === e.target.value)?.name}”`)}>
                            {KINDS.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                          </select>
                          <button className="icon-btn" aria-label={`Remove ${d.name}`} onClick={() => confirm(`Delete ${d.name}? The file is removed from JobFinder.`) && run("docDelete", { docId: d.id }, `${d.name} removed`)}><Trash2 /></button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
        <aside className="col-4 docs-side">
          <div className="card">
            <div className="card-h"><Sparkles />What JobFinder does with them</div>
            <ul className="derived">
              <li><span className="feed-dot"><ListChecks /></span><div><b>Fact base</b><span>{facts ? `${facts} verified facts from ${positions} positions in your CV. Every claim in a cover letter is checked against them.` : "Upload your CV – it becomes the only source for claims in your letters."}</span></div></li>
              <li><span className="feed-dot"><Feather /></span><div><b>Style guide</b><span>{style ? `From ${letters} cover letter${letters === 1 ? "" : "s"}.${letters < 3 ? " More accurate from 3 letters." : ""}` : "Upload a few of your own cover letters so drafts sound like you."}</span>{style && <button className="btn ghost sm" onClick={() => setShowStyle((v) => !v)}>{showStyle ? "Hide" : "View"}</button>}</div></li>
              <li><span className="feed-dot"><Paperclip /></span><div><b>Attachments</b><span>{attachBytes ? `Selected references and certificates are appended to each application PDF (≈ ${fmt(attachBytes)}${attachBytes > 4e6 ? " – close to the usual 5 MB limit" : ", under 5 MB"}).` : "References and certificates you upload are appended to each application PDF."}</span></div></li>
            </ul>
            {showStyle && style && <div style={{ padding: "0 18px 16px" }}><Markdown text={style} /></div>}
          </div>
          <div className="card privacy"><Lock /><span>Files stay in JobFinder&apos;s data folder on this Mac. Only their text is sent to Claude when reading.</span></div>
        </aside>
      </div>
    </div>
  );
}
