"use client";

import { Brain, Check, History, Pencil, RotateCcw, Settings2, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Settings } from "@/lib/db";
import { act, toast } from "@/lib/client";
import { timeAgo } from "@/lib/ui";
import { SettingsForm } from "../_components/SettingsForm";
import { Markdown } from "../_components/ui";

type P = { version: number; markdown: string; diff_summary: string | null; created_by: string; created_at: string } | null;

export function ProfileClient({ profile, history, settings }: { profile: P; history: { version: number; diff_summary: string | null; created_by: string; created_at: string }[]; settings: Settings }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [md, setMd] = useState(profile?.markdown ?? "");

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
        <div className="date"><UserRound />What Kompass knows about what you want</div>
        <h1 style={{ fontSize: 44 }}>Profile</h1>
      </section>
      <div className="bento">
        <div className="card col-8">
          <div className="card-h"><Brain />Preference profile {profile && <span className="muted faint">· v{profile.version} by {profile.created_by}</span>}
            {!edit && <button className="right btn ghost sm" onClick={() => { setMd(profile?.markdown ?? ""); setEdit(true); }}><Pencil />Edit</button>}
          </div>
          <div style={{ padding: "6px 18px 18px" }}>
            {edit ? (
              <>
                <textarea className="input md-edit" value={md} onChange={(e) => setMd(e.target.value)} aria-label="Preference profile" />
                <div className="form-actions"><button className="btn ghost" onClick={() => setEdit(false)}><X />Cancel</button><button className="btn primary" onClick={async () => { await run("saveProfile", { markdown: md }, "Profile saved – new ads are scored with it"); setEdit(false); }}><Check />Save</button></div>
              </>
            ) : profile ? <Markdown text={profile.markdown} /> : <p className="faint">No profile yet. It is created during setup from example ads.</p>}
            <p className="hint" style={{ padding: 0 }}>Claude reads this before scoring every ad. Every night it rewrites it from your latest decisions; you can edit it any time or go back to an older version.</p>
          </div>
        </div>
        <div className="card col-4">
          <div className="card-h"><History />History<button className="right btn ghost sm" onClick={() => run("reflectNow", {}, "Updating from your decisions…")}>Update now</button></div>
          <ul className="list compact">
            {history.map((h) => (
              <li key={h.version}>
                <span className="mono faint" style={{ width: 28 }}>v{h.version}</span>
                <div className="grow"><b>{h.diff_summary || "—"}</b><span className="faint">{h.created_by} · {timeAgo(h.created_at)}</span></div>
                {profile && h.version !== profile.version && <button className="icon-btn" aria-label={`Revert to v${h.version}`} onClick={() => run("revertProfile", { version: h.version }, `Reverted to v${h.version}`)}><RotateCcw /></button>}
              </li>
            ))}
          </ul>
        </div>
        <div className="card col-12" id="settings">
          <div className="card-h"><Settings2 />Settings</div>
          <SettingsForm initial={settings} sections={["personal", "application", "filters", "writing", "app"]} onSaved={() => router.refresh()} />
        </div>
      </div>
    </div>
  );
}
