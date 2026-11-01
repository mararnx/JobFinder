"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import type { Settings } from "@/lib/db";
import { act, toast } from "@/lib/client";

type Section = "personal" | "application" | "filters" | "writing" | "app";

export function SettingsForm({ initial, sections, onSaved, submitLabel = "Save" }: { initial: Settings; sections: Section[]; onSaved?: (s: Settings) => void; submitLabel?: string }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const txt = (k: keyof Settings, label: string, ph = "", type = "text", wide = false) => (
    <label className={`fld${wide ? " wide" : ""}`}><span>{label}</span><input className="input" type={type} value={String(s[k] ?? "")} placeholder={ph} onChange={(e) => set(k, (type === "number" ? Number(e.target.value) : e.target.value) as never)} /></label>
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await act<Settings>("saveSettings", { patch: s });
      toast("Saved");
      onSaved?.(saved);
    } catch (err) {
      toast((err as Error).message, undefined, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={save}>
      {sections.includes("personal") && (
        <>
          <div className="form-sec wide">About you <span className="faint">– used in letters and forms</span></div>
          {txt("name", "Full name", "Alex Neumann")}
          {txt("email", "Email", "alex@example.com", "email")}
          {txt("phone", "Phone", "+49 …", "tel")}
          {txt("address", "Address (letter head)", "Musterstraße 1, 20095 Hamburg")}
          {txt("home", "Where you live", "Hamburg")}
        </>
      )}
      {sections.includes("application") && (
        <>
          <div className="form-sec wide">Application details</div>
          {txt("salaryExpectation", "Salary expectation (as you'd write it)", "€85,000 gross per year")}
          {txt("noticePeriod", "Notice period", "3 months to the end of a month")}
          {txt("earliestStart", "Earliest start", "February 1, 2027")}
        </>
      )}
      {sections.includes("filters") && (
        <>
          <div className="form-sec wide">Hard filters <span className="faint">– ads that fail these never reach you</span></div>
          {txt("salaryFloor", "Salary floor (€ / year, 0 = none)", "65000", "number")}
          {txt("remoteMin", "Remote days wanted (0 = don't care)", "2", "number")}
          {txt("commuteKm", "Max commute (km)", "40", "number")}
          <label className="fld"><span>Ad languages</span>
            <select className="input" value={s.languages.join(",")} onChange={(e) => set("languages", e.target.value.split(","))}>
              <option value="de,en">German and English</option><option value="de">German only</option><option value="en">English only</option>
            </select>
          </label>
          <label className="fld wide"><span>Blocked words <span className="faint">(comma-separated, e.g. Werkstudent, Praktikum, SAP)</span></span>
            <input className="input" value={s.blockKeywords.join(", ")} onChange={(e) => set("blockKeywords", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
          </label>
          <label className="check wide"><input type="checkbox" checked={s.excludeAgencies} onChange={(e) => set("excludeAgencies", e.target.checked)} /><span>Hide recruiters and temp agencies (Personalvermittlung, Zeitarbeit)</span></label>
        </>
      )}
      {sections.includes("writing") && (
        <>
          <div className="form-sec wide">Cover letters <span className="faint">– your own rules, e.g. from a Claude project you already use</span></div>
          <label className="fld wide"><span>Instructions for every letter</span>
            <textarea className="input" rows={8} value={s.letterInstructions} onChange={(e) => set("letterInstructions", e.target.value)} placeholder={"e.g. Max 250 words. Open with a concrete result from my last role. Never use 'leidenschaftlich'. Close with availability and salary in one sentence."} />
          </label>
        </>
      )}
      {sections.includes("app") && (
        <>
          <div className="form-sec wide">App</div>
          {txt("weeklyGoal", "Weekly application goal", "30", "number")}
          {txt("chromeDailyPages", "Chrome: max pages per portal per day", "40", "number")}
          {txt("claudeParallel", "Parallel Claude jobs (1 saves quota)", "1", "number")}
        </>
      )}
      <div className="form-actions wide"><button className="btn primary" type="submit" disabled={busy}><Check />{submitLabel}</button></div>
    </form>
  );
}
