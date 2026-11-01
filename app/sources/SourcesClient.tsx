"use client";

import { Ban, Bot, Building2, AppWindow, Globe, Pause, Play, Plus, RefreshCw, RotateCcw, Search, ShieldAlert, Trash2, Pencil, Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { act, toast } from "@/lib/client";
import { timeAgo } from "@/lib/ui";
import { MoreSources, type MoreSourcesProps } from "../_components/MoreSources";
import { Tile } from "../_components/ui";

type Profile = { id: number; name: string; keywords: string[]; location: string; radius_km: number; enabled: number };
type Run = { status: string; started_at: string; added: number; found: number; message: string | null };
type Source = { key: string; name: string; kind: "api" | "chrome"; detail: string; last: Run | null; used: number | null; blocked: string | null };

export function SourcesClient(p: {
  profiles: Profile[]; sources: Source[]; watchlist: { id: number; name: string; ats_type: string | null; careers_url: string | null; jobs: number }[];
  blocked: { id: number; name: string }[]; runs: (Run & { source: string })[]; failed: { id: number; type: string; error: string | null; finished_at: string | null; payload: string }[];
  more: MoreSourcesProps; chromePortals: string[];
  chromeEnabled: boolean; chromeDailyPages: number; claude: { mock: boolean; cli: string | null; mode: string; pausedUntil: string | null };
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<Partial<Profile> & { kw?: string } | null>(null);
  const [wName, setWName] = useState("");
  const [wUrl, setWUrl] = useState("");

  const run = async (action: string, args: Record<string, unknown>, msg: string) => {
    try {
      await act(action, args);
      toast(msg);
      router.refresh();
      return true;
    } catch (e) {
      toast((e as Error).message, undefined, "error");
      return false;
    }
  };

  return (
    <div className="view-inner enter">
      <section className="hero" style={{ paddingBottom: 22 }}>
        <div className="date"><Search />Where JobFinder looks</div>
        <h1 style={{ fontSize: 44 }}>Sources</h1>
      </section>
      <div className="bento">
        <div className="card col-7">
          <div className="card-h">Search profiles<button className="right btn ghost sm" onClick={() => setEdit({ name: "", kw: "", location: "", radius_km: 30 })}><Plus />Add</button></div>
          <ul className="list">
            {p.profiles.map((sp) => (
              <li key={sp.id} className={sp.enabled ? "" : "off"}>
                <div className="grow"><b>{sp.name}</b><span className="faint">{sp.keywords.join(", ")} · {sp.location || "anywhere"}{sp.location ? ` + ${sp.radius_km} km` : ""}</span></div>
                <button className="icon-btn" aria-label={sp.enabled ? "Pause" : "Resume"} onClick={() => run("toggleSearch", { id: sp.id }, sp.enabled ? "Paused" : "Resumed")}>{sp.enabled ? <Pause /> : <Play />}</button>
                <button className="icon-btn" aria-label="Edit" onClick={() => setEdit({ ...sp, kw: sp.keywords.join(", ") })}><Pencil /></button>
                <button className="icon-btn" aria-label="Delete" onClick={() => confirm(`Delete “${sp.name}”?`) && run("deleteSearch", { id: sp.id }, "Deleted")}><Trash2 /></button>
              </li>
            ))}
            {!p.profiles.length && !edit && <li className="faint">No search yet – add one with the keywords you&apos;d type into a job portal.</li>}
          </ul>
          {edit && (
            <form className="form-grid" onSubmit={async (e) => { e.preventDefault(); if (await run("saveSearch", { id: edit.id, name: edit.name, keywords: edit.kw, location: edit.location, radius: edit.radius_km }, "Search saved")) setEdit(null); }}>
              <label className="fld"><span>Name</span><input className="input" value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Product roles Hamburg" /></label>
              <label className="fld wide"><span>Keywords <span className="faint">(comma-separated, each is one search)</span></span><input className="input" value={edit.kw ?? ""} onChange={(e) => setEdit({ ...edit, kw: e.target.value })} placeholder="Product Owner, Produktmanager, Product Manager" required /></label>
              <label className="fld"><span>Location</span><input className="input" value={edit.location ?? ""} onChange={(e) => setEdit({ ...edit, location: e.target.value })} placeholder="Hamburg (empty = all of Germany)" /></label>
              <label className="fld"><span>Radius (km)</span><input className="input" type="number" min={0} max={200} value={edit.radius_km ?? 30} onChange={(e) => setEdit({ ...edit, radius_km: Number(e.target.value) })} /></label>
              <div className="form-actions wide"><button type="button" className="btn ghost" onClick={() => setEdit(null)}><X />Cancel</button><button className="btn primary" type="submit"><Check />Save</button></div>
            </form>
          )}
        </div>

        <div className="card col-5">
          <div className="card-h"><Bot />Claude</div>
          <div className="kv">
            <div><span>Connection</span><b>{p.claude.cli ? `Claude Code ${p.claude.cli}` : "CLI not found"}</b></div>
            <div><span>Mode</span><b>{p.claude.mock ? "Mock (simulated answers)" : "Real – your Max subscription"}</b></div>
            {p.claude.pausedUntil && <div><span>Usage limit</span><b style={{ color: "var(--dream)" }}>Paused until {new Date(p.claude.pausedUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</b></div>}
          </div>
          {!p.claude.cli && <p className="hint">Install Claude Code on this Mac and run <code>claude</code> once to log in with the Max account. Until then every AI step is simulated so you can try the app.</p>}
          <div className="form-actions" style={{ padding: "0 18px 16px" }}>
            <select className="kind-sel" value={p.claude.mode} aria-label="Claude mode" onChange={(e) => run("saveSettings", { patch: { claudeMode: e.target.value } }, "Saved")}>
              <option value="auto">Auto (real if installed)</option><option value="real">Always real</option><option value="mock">Always mock</option>
            </select>
            {p.claude.pausedUntil && <button className="btn sm" onClick={() => run("resumeClaude", {}, "Resumed")}><Play />Resume now</button>}
          </div>
        </div>

        <div className="card col-12">
          <div className="card-h">Sources
            <label className="right switch"><input type="checkbox" checked={p.chromeEnabled} onChange={(e) => run("saveSettings", { patch: { chromeEnabled: e.target.checked } }, e.target.checked ? "Chrome search on" : "Chrome search off")} /><span>Chrome search on portals</span></label>
          </div>
          <div className="source-grid">
            {p.sources.map((s) => {
              const off = (s.kind === "chrome" && (!p.chromeEnabled || !p.chromePortals.includes(s.key))) || s.detail.startsWith("Not set up");
              return (
                <div key={s.key} className={`source${off ? " off" : ""}`}>
                  <div className="row">{s.kind === "chrome" ? <AppWindow /> : s.key === "watchlist" ? <Building2 /> : <Globe />}<b>{s.name}</b>
                    {s.blocked ? <span className="tag bad"><ShieldAlert />{s.blocked}</span> : s.last?.status === "error" ? <span className="tag bad">Error</span> : s.last?.status === "running" ? <span className="tag info">Running</span> : off ? <span className="tag">Off</span> : <span className="tag ok">OK</span>}
                  </div>
                  <div className="faint">{s.detail}</div>
                  <div className="faint">{s.last ? `Last run ${timeAgo(s.last.started_at)} · ${s.last.added ? `${s.last.added} new` : "no new ads"}` : "Never run"}</div>
                  {s.last?.message && <div className="err-line" title={s.last.message}>{s.last.message}</div>}
                  <button className="btn ghost sm" disabled={off} onClick={() => run("fetchSource", { source: s.key }, `${s.name} queued`)}><RefreshCw />Run now</button>
                </div>
              );
            })}
          </div>
          <p className="hint">Chrome search uses its own browser profile at a slow, human pace (max {p.chromeDailyPages} pages per portal per day). It stops for the day on any CAPTCHA, bot check or login wall – it never tries to get around them. To use logged-in portals, run <code>npm run browser</code> once and log in there yourself.</p>
        </div>

        <div className="card col-12" id="more-sources">
          <div className="card-h"><Globe />Set up more sources <span className="muted faint">· job alerts, API keys, the browser button, Chrome portals</span></div>
          <MoreSources {...p.more} />
        </div>

        <div className="card col-7" id="watchlist">
          <div className="card-h"><Building2 />Company watchlist <span className="muted faint">· checked daily, matches get a boost</span></div>
          <form className="watch-form" onSubmit={async (e) => { e.preventDefault(); if (await run("watchlistAdd", { name: wName, url: wUrl }, `${wName} added – checking now`)) { setWName(""); setWUrl(""); } }}>
            <input className="input" value={wName} onChange={(e) => setWName(e.target.value)} placeholder="Company name" required aria-label="Company name" />
            <input className="input" value={wUrl} onChange={(e) => setWUrl(e.target.value)} placeholder="Careers page URL (Personio, Greenhouse, Lever…)" required aria-label="Careers page URL" />
            <button className="btn primary" type="submit"><Plus />Add</button>
          </form>
          <ul className="list">
            {p.watchlist.map((c) => (
              <li key={c.id}>
                <Tile name={c.name} small />
                <div className="grow"><b>{c.name}</b><span className="faint">{c.ats_type === "page" ? "Careers page (needs Chrome search)" : c.ats_type ?? "?"} · {c.jobs} job{c.jobs === 1 ? "" : "s"} found</span></div>
                <button className="icon-btn" aria-label={`Remove ${c.name}`} onClick={() => run("watchlistRemove", { companyId: c.id }, `${c.name} removed`)}><Trash2 /></button>
              </li>
            ))}
            {!p.watchlist.length && <li className="faint">Add companies you&apos;d love to work for. JobFinder reads their job feed directly – often before the portals.</li>}
          </ul>
          {p.blocked.length > 0 && (
            <>
              <div className="card-h" style={{ paddingTop: 6 }}><Ban />Blocked companies</div>
              <div className="chips" style={{ padding: "8px 18px 16px" }}>
                {p.blocked.map((b) => <button key={b.id} className="chip" onClick={() => run("unblockCompany", { companyId: b.id }, `${b.name} unblocked`)}>{b.name} <X /></button>)}
              </div>
            </>
          )}
        </div>

        <div className="card col-5">
          <div className="card-h">Recent runs</div>
          <ul className="list compact">
            {p.runs.map((r, i) => (
              <li key={i}><span className={`dot-s ${r.status}`} /><div className="grow"><b>{r.source}</b><span className="faint">{timeAgo(r.started_at)} · {r.added} new / {r.found}{r.message ? ` · ${r.message}` : ""}</span></div></li>
            ))}
            {!p.runs.length && <li className="faint">No runs yet.</li>}
          </ul>
          {p.failed.length > 0 && (
            <>
              <div className="card-h" style={{ paddingTop: 6 }}>Failed tasks</div>
              <ul className="list compact">
                {p.failed.map((t) => (
                  <li key={t.id}><span className="dot-s error" /><div className="grow"><b>{t.type}</b><span className="faint" title={t.error ?? ""}>{(t.error ?? "").slice(0, 90)}</span></div>
                    <button className="icon-btn" aria-label="Retry" onClick={() => run("retryTask", { taskId: t.id }, "Retrying")}><RotateCcw /></button></li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
