"use client";

import { ChartNoAxesCombined, Compass, FolderOpen, Kanban, Keyboard, Link as LinkIcon, LoaderCircle, PenLine, Plus, Radar, RefreshCw, Search, Settings2, Sparkles, Sun, SunMoon, UserRound, Upload, Briefcase, Check, X, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRestoreFocus } from "./useRestoreFocus";
import { act, openAddAd, openJob, toast, type ToastMsg } from "@/lib/client";
import { JobDrawer } from "./JobDrawer";

export type ShellStatus = {
  counts: { discover: number; review: number; documents: number };
  claude: { mock: boolean; callsWindow: number; pausedUntil: string | null; failing: number };
  worker: { alive: boolean; queued: number; running: number };
  onboarded: boolean;
};

const NAV = [
  { href: "/", label: "Today", icon: Sun, key: "h" },
  { href: "/discover", label: "Discover", icon: Sparkles, key: "d", badge: "discover" as const, hot: true },
  { href: "/pipeline", label: "Pipeline", icon: Kanban, key: "p" },
  { href: "/review", label: "Review", icon: PenLine, key: "r", badge: "review" as const },
  { href: "/insights", label: "Insights", icon: ChartNoAxesCombined, key: "i" },
];
const SETUP = [
  { href: "/documents", label: "Documents", icon: FolderOpen, key: "u", badge: "documents" as const },
  { href: "/sources", label: "Sources", icon: Radar, key: "s" },
  { href: "/profile", label: "Profile", icon: UserRound, key: "o" },
];
const TITLES: Record<string, string> = { "/": "Today", "/discover": "Discover", "/pipeline": "Pipeline", "/review": "Review", "/insights": "Insights", "/documents": "Documents", "/sources": "Sources", "/profile": "Profile", "/onboarding": "Set up Kompass" };

export function Shell({ status, children }: { status: ShellStatus; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const [addAd, setAddAd] = useState(false);
  const [toasts, setToasts] = useState<(ToastMsg & { id: number })[]>([]);
  const [fetching, setFetching] = useState(false);
  const gPending = useRef(false);

  const toggleTheme = useCallback(() => {
    const root = document.documentElement;
    const cur = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("kompass-theme", next); } catch { /* private mode */ }
  }, []);

  const fetchSources = useCallback(async () => {
    setFetching(true);
    try {
      await act("fetchSources");
      toast("Fetching all sources – new ads appear in Discover");
    } catch (e) {
      toast(String((e as Error).message), undefined, "error");
    } finally {
      setTimeout(() => setFetching(false), 1200);
    }
  }, []);

  // toasts
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ToastMsg>).detail;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { ...d, id }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), d.undo ? 6000 : 4000);
    };
    const add = () => setAddAd(true);
    window.addEventListener("kompass:toast", on);
    window.addEventListener("kompass:add-ad", add);
    return () => {
      window.removeEventListener("kompass:toast", on);
      window.removeEventListener("kompass:add-ad", add);
    };
  }, []);

  // live refresh while the worker changes things
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const a = document.activeElement;
      if (a && (a.closest("input, textarea, select, [contenteditable]") || document.querySelector(".palette.show, .drawer.show"))) return;
      router.refresh();
    }, 6000);
    return () => clearInterval(t);
  }, [router]);

  // marks the page interactive (the UI test waits for it)
  useEffect(() => {
    document.documentElement.dataset.ready = "1";
  }, []);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (e.key === "Escape") {
        setPalette(false);
        setAddAd(false);
        return;
      }
      const t = e.target as HTMLElement;
      if (t.closest?.("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector(".palette.show, .drawer.show")) return;
      const k = e.key.toLowerCase();
      if (gPending.current) {
        gPending.current = false;
        const dest = [...NAV, ...SETUP].find((n) => n.key === k);
        if (dest) router.push(dest.href);
        return;
      }
      if (k === "g") {
        gPending.current = true;
        setTimeout(() => (gPending.current = false), 900);
      } else if (k === "n") {
        e.preventDefault();
        setAddAd(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const title = TITLES[path] ?? "Kompass";
  const sub = path === "/discover" ? `${status.counts.discover} to go through · by score` : path === "/review" ? `${status.counts.review} drafts` : "";
  const quotaPct = status.claude.mock ? 0 : Math.min(100, Math.round((status.claude.callsWindow / 120) * 100));
  const paused = status.claude.pausedUntil ? new Date(status.claude.pausedUntil) : null;

  const navLink = (n: (typeof NAV)[number] | (typeof SETUP)[number], extra = "") => {
    const Icon = n.icon;
    const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
    const count = "badge" in n && n.badge ? status.counts[n.badge] : 0;
    return (
      <Link key={n.href} href={n.href} className={extra} aria-current={active ? "page" : undefined}>
        <Icon />
        <span>{n.label}</span>
        {count > 0 && <span className={`badge${"hot" in n && n.hot ? " hot" : ""}`}>{count}</span>}
      </Link>
    );
  };

  return (
    <>
      <a className="sr-only" href="#view">Skip to content</a>
      <div className="app">
        <aside className="sidebar" aria-label="Main navigation">
          <div className="brand">
            <div className="brand-mark"><Compass /></div>
            <span className="brand-name">Kompass</span>
          </div>
          <nav className="nav">
            {NAV.map((n) => navLink(n))}
            <div className="nav-label extra">Setup</div>
            {SETUP.map((n) => navLink(n, "extra"))}
          </nav>
          <div className="sidebar-foot">
            <div className="quota">
              <div className="quota-top">
                <span>{status.claude.mock ? "Claude · mock mode" : "Claude Max"}</span>
                <span className="mono">{status.claude.mock ? "–" : `${status.claude.callsWindow} calls`}</span>
              </div>
              <div className="meter"><i style={{ width: `${paused ? 100 : quotaPct}%`, background: paused ? "var(--dream)" : undefined }} /></div>
              <div className="quota-sub">
                <span className="pulse" style={status.worker.alive ? undefined : { background: "var(--danger)", animation: "none" }} />
                {!status.worker.alive ? "Worker not running" : paused ? `Paused until ${paused.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : status.worker.running ? `Working · ${status.worker.queued} queued` : "Worker idle"}
              </div>
            </div>
            <div className="foot-row">
              <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle color scheme"><SunMoon /></button>
              <Link className="icon-btn" href="/profile#settings" aria-label="Settings"><Settings2 /></Link>
              <button className="icon-btn" aria-label="Keyboard shortcuts" onClick={() => toast("J/K navigate · A apply · D dream · X reject · S later · N add ad · G then H/D/P/R/I go to · ⌘K commands")}><Keyboard /></button>
            </div>
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <div className="crumb">{title}{sub && <small>{sub}</small>}</div>
            {status.claude.mock && <span className="tag warn" title="The Claude Code CLI was not found, so AI answers are simulated. Install Claude Code and log in to use the real thing."><TriangleAlert />Mock AI</span>}
            <button className="search" onClick={() => setPalette(true)} aria-label="Open command palette"><Search /><span>Jobs, companies, commands…</span><kbd>⌘K</kbd></button>
            <button className="btn" onClick={() => setAddAd(true)} aria-label="Add your own job ad"><LinkIcon /><span className="lbl">Add job ad</span><kbd className="lbl">N</kbd></button>
            <button className="btn" onClick={fetchSources} disabled={fetching}>{fetching ? <LoaderCircle className="spin-icon" /> : <RefreshCw />}<span className="lbl">{fetching ? "Queued…" : "Fetch sources"}</span></button>
          </header>
          <main className="view" id="view" tabIndex={-1}>{children}</main>
        </div>
      </div>

      <Palette open={palette} onClose={() => setPalette(false)} actions={{ fetchSources, toggleTheme }} />
      <AddAdDialog open={addAd} onClose={() => setAddAd(false)} />
      <JobDrawer />
      <div className="toasts" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast show${t.tone === "error" ? " error" : ""}`}>
            {t.tone === "error" ? <X /> : <Check />}
            <span>{t.text}</span>
            {t.undo && <button onClick={() => { t.undo?.(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}>Undo</button>}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Command palette ───────────────────────────────────── */

type Cmd = { group: string; icon: React.ComponentType; label: string; keys?: string; run: () => void };

function Palette({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: { fetchSources: () => void; toggleTheme: () => void } }) {
  useRestoreFocus(open);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [jobs, setJobs] = useState<{ id: number; title: string; company: string; stageLabel: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setJobs([]);
      input.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) return setJobs([]);
    const ctl = new AbortController();
    fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((d) => setJobs(d.jobs)).catch(() => {});
    return () => ctl.abort();
  }, [q]);

  const go = (href: string) => () => router.push(href);
  const cmds: Cmd[] = [
    ...[...NAV, ...SETUP].map((n) => ({ group: "Go to", icon: n.icon, label: n.label, keys: `G ${n.key.toUpperCase()}`, run: go(n.href) })),
    { group: "Actions", icon: LinkIcon, label: "Add your own job ad…", keys: "N", run: () => openAddAd() },
    { group: "Actions", icon: Upload, label: "Upload documents…", run: go("/documents") },
    { group: "Actions", icon: RefreshCw, label: "Fetch all sources now", run: actions.fetchSources },
    { group: "Actions", icon: Plus, label: "Add company to watchlist…", run: go("/sources#watchlist") },
    { group: "Actions", icon: SunMoon, label: "Toggle color scheme", run: actions.toggleTheme },
  ];
  const ql = q.toLowerCase();
  const items: Cmd[] = [
    ...cmds.filter((c) => c.label.toLowerCase().includes(ql)),
    ...jobs.map((j) => ({ group: "Jobs", icon: Briefcase, label: `${j.title} · ${j.company}`, keys: j.stageLabel, run: () => openJob(j.id) })),
  ];
  const run = (i: number) => {
    const c = items[i];
    onClose();
    c?.run();
  };
  let lastGroup = "";
  return (
    <>
      <div className={`scrim${open ? " show" : ""}`} onClick={onClose} />
      <div className={`palette${open ? " show" : ""}`} role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={input}
          value={q}
          placeholder="Go to a job, company or command…"
          aria-label="Search"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length));
            }
            if (e.key === "Enter") run(sel);
          }}
        />
        <div className="pal-list" role="listbox">
          {items.length === 0 && <div className="pal-group">No results</div>}
          {items.map((c, i) => {
            const Icon = c.icon;
            const header = c.group !== lastGroup ? <div className="pal-group">{(lastGroup = c.group)}</div> : null;
            return (
              <div key={`${c.group}-${c.label}`}>
                {header}
                <button className="pal-item" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(i)}>
                  <Icon />{c.label}{c.keys && <kbd>{c.keys}</kbd>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ── Add your own job ad ───────────────────────────────── */

function AddAdDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useRestoreFocus(open);
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [applyNow, setApplyNow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setUrl(""); setText(""); setNote(""); setApplyNow(false); setErr("");
      setTimeout(() => urlRef.current?.focus(), 0);
    }
  }, [open]);

  const submit = async () => {
    const valid = /^https?:\/\/[^\s.]+\.[^\s]+/.test(url.trim());
    if (!text.trim() && !valid) {
      setErr(url ? "That isn't a valid link. It must start with https:// – or paste the text below." : "Paste a link, or paste the ad text below.");
      urlRef.current?.focus();
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await act<{ jobId: number }>("addManual", { url: valid ? url.trim() : "", text, note, applyNow });
      onClose();
      toast(applyNow ? "Added and shortlisted · Claude is writing the draft" : "Added · it appears in Discover once scored");
      router.push(applyNow ? "/pipeline" : "/discover");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={`scrim${open ? " show" : ""}`} onClick={() => !busy && onClose()} />
      <form
        className={`palette addad${open ? " show" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="addad-t"
        noValidate
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void submit(); } }}
      >
        <div className="addad-b">
          <h2 id="addad-t"><LinkIcon />Add your own job ad</h2>
          <p className="faint">Found one yourself? Paste the link – Kompass reads the ad, scores it and adds it to the stack.</p>
          <label className="fld"><span>Link to the ad</span>
            <input ref={urlRef} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://careers.company.com/jobs/…" autoComplete="off" aria-invalid={!!err && !text} />
          </label>
          {err && <p className="fld-err" role="alert">{err}</p>}
          <details className="fld-more" open={!!text}>
            <summary>Link won&apos;t work (login, PDF, printed notice)? Paste the text</summary>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the job ad text here" />
          </details>
          <label className="fld"><span>Note <span className="faint">(optional)</span></span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. referred by Jana, contact person Mr Kühn" />
          </label>
          <div className="fld-row" role="radiogroup" aria-label="What should happen?">
            <label className="opt"><input type="radio" name="dest" checked={!applyNow} onChange={() => setApplyNow(false)} /><span><b>Score it</b><small>Goes to Discover with a score</small></span></label>
            <label className="opt"><input type="radio" name="dest" checked={applyNow} onChange={() => setApplyNow(true)} /><span><b>Apply right away</b><small>Claude starts the draft now</small></span></label>
          </div>
        </div>
        <div className="addad-f">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel <kbd>esc</kbd></button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? <><LoaderCircle className="spin-icon" />Reading…</> : <><Plus />Add <kbd>⌘↵</kbd></>}</button>
        </div>
      </form>
    </>
  );
}
