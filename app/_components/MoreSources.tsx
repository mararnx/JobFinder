"use client";

import { Bell, Bookmark, Check, ExternalLink, Globe, KeyRound, LoaderCircle, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { act, toast } from "@/lib/client";
import "./more-sources.css";

export type MoreSourcesProps = {
  keyword: string; city: string;
  settings: { gmailAddress: string; alertsLabel: string; adzunaAppId: string; adzunaAppKey: string; joobleKey: string; chromeEnabled: boolean; chromePortals: string[] };
};

const PORTALS = [
  { key: "stepstone", name: "StepStone", save: "Jobagent erstellen", url: (k: string, c: string) => `https://www.stepstone.de/jobs/${encodeURIComponent(k.toLowerCase().replace(/\s+/g, "-"))}${c ? `/in-${encodeURIComponent(c.toLowerCase())}` : ""}` },
  { key: "indeed", name: "Indeed", save: "Job-Alert erhalten", url: (k: string, c: string) => `https://de.indeed.com/jobs?q=${encodeURIComponent(k)}&l=${encodeURIComponent(c)}` },
  { key: "linkedin", name: "LinkedIn", save: "Jobalert aktivieren (needs login)", url: (k: string, c: string) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(k)}&location=${encodeURIComponent(c || "Deutschland")}` },
  { key: "xing", name: "XING", save: "Suchauftrag speichern", url: (k: string, c: string) => `https://www.xing.com/jobs/search?keywords=${encodeURIComponent(k)}&location=${encodeURIComponent(c)}` },
];

// the senders of the portals' alert emails, as a Gmail search
const ALERT_QUERY = "from:(stepstone.de OR indeed.com OR jobalerts-noreply@linkedin.com OR xing.com)";

const CHROME_NOTE: Record<string, string> = {
  xing: "Works",
  linkedin: "Once a day, max. 5 ads – it limits automated visits",
  stepstone: "Blocks automated browsing – use its email alerts",
  indeed: "Blocks automated browsing – use its email alerts",
};

/** The bookmark the job seeker drags to their bookmarks bar: posts the open page to JobFinder. */
function bookmarklet(origin: string) {
  const code = `(()=>{const f=document.createElement('form');f.method='POST';f.action='${origin}/api/capture';f.target='_blank';f.acceptCharset='utf-8';const a=(n,v)=>{const i=document.createElement('input');i.type='hidden';i.name=n;i.value=v;f.appendChild(i)};a('url',location.href);a('title',document.title);a('html',document.documentElement.outerHTML.slice(0,3000000));document.body.appendChild(f);f.submit();f.remove()})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

export function MoreSources({ keyword, city, settings }: MoreSourcesProps) {
  const router = useRouter();
  const [box, setBox] = useState(settings.alertsLabel || "Job alerts");
  const [keys, setKeys] = useState({ adzunaAppId: settings.adzunaAppId, adzunaAppKey: settings.adzunaAppKey, joobleKey: settings.joobleKey });
  const [busy, setBusy] = useState<string | null>(null);
  const [chrome, setChrome] = useState({ on: settings.chromeEnabled, portals: settings.chromePortals });
  const [alertMsg, setAlertMsg] = useState<string | null>(settings.alertsLabel && settings.gmailAddress ? `Reading the label "${settings.alertsLabel}" every 2 hours` : null);
  const mark = useRef<HTMLAnchorElement>(null);

  // React refuses javascript: links in JSX, so the bookmark's href is set directly
  useEffect(() => {
    mark.current?.setAttribute("href", bookmarklet(window.location.origin));
  }, []);

  const go = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, undefined, "error");
    } finally {
      setBusy(null);
    }
  };

  const checkAlerts = () => go("alerts", async () => {
    const r = await act<{ message: string }>("checkAlerts", { label: box });
    setAlertMsg(r.message);
    toast(r.message);
    router.refresh();
  });

  const saveKeys = () => go("keys", async () => {
    await act("saveSettings", { patch: keys });
    if ((keys.adzunaAppId && keys.adzunaAppKey) || keys.joobleKey) await act("fetchSource", { source: "apis" });
    toast((keys.adzunaAppId && keys.adzunaAppKey) || keys.joobleKey ? "Saved · searching now" : "Saved");
    router.refresh();
  });

  const togglePortal = (p: string, on: boolean) => {
    const prev = chrome;
    const next = { on: on || chrome.on, portals: on ? [...new Set([...chrome.portals, p])] : chrome.portals.filter((x) => x !== p) };
    setChrome(next); // flip at once; roll back if saving fails
    void go(`p:${p}`, async () => {
      try {
        await act("saveSettings", { patch: { chromePortals: next.portals, chromeEnabled: next.on } });
        router.refresh();
      } catch (e) {
        setChrome(prev);
        throw e;
      }
    });
  };

  const kw = keyword || "Product Manager";

  return (
    <div className="more-sources">
      <section className="ms-card">
        <h3><Bell />Job alerts by email <span className="tag accent">recommended</span></h3>
        <p className="faint">The official way to get everything from StepStone, Indeed, LinkedIn and XING. The portals email new matches to your Gmail; JobFinder reads them from one label.</p>
        <ol className="ms-steps">
          <li>
            <b>Save a search with alerts on each portal.</b> Each button opens your search – click the alert button there.
            <div className="ms-portals">
              {PORTALS.map((p) => <a key={p.key} href={p.url(kw, city)} target="_blank" rel="noreferrer">{p.name}<ExternalLink /><small>then: {p.save}</small></a>)}
            </div>
          </li>
          <li>
            <b>In Gmail, label the alerts.</b> <a className="link" href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(settings.gmailAddress)}#search/${encodeURIComponent(ALERT_QUERY)}`} target="_blank" rel="noreferrer">Open this search in Gmail</a>, click the filter icon at the right of the search box → <i>Create filter</i> → tick <i>Apply the label</i> → <i>New label</i> <span className="mono">{box || "Job alerts"}</span> → tick <i>Also apply filter to matching conversations</i> → <i>Create filter</i>.
          </li>
          <li>
            <b>Connect it.</b>{!settings.gmailAddress && <> Connect Gmail first (the card above).</>}
            <div className="ms-row">
              <input className="input" value={box} onChange={(e) => setBox(e.target.value)} aria-label="Gmail label" placeholder="Job alerts" />
              <button className="btn primary" onClick={checkAlerts} disabled={busy === "alerts" || !box.trim() || !settings.gmailAddress}>{busy === "alerts" ? <LoaderCircle className="spin-icon" /> : <Mail />}Connect &amp; check</button>
            </div>
            {alertMsg && <p className="ms-ok"><Check />{alertMsg}</p>}
          </li>
        </ol>
      </section>

      <section className="ms-card">
        <h3><KeyRound />Job search APIs <span className="faint">– free keys, 2 minutes each</span></h3>
        <p className="faint">Adzuna and Jooble collect ads from many German portals and company sites – a big share of what StepStone and Indeed list.</p>
        <div className="ms-keys">
          <label className="fld"><span>Adzuna app ID <a href="https://developer.adzuna.com/signup" target="_blank" rel="noreferrer">get a free key</a></span><input className="input" value={keys.adzunaAppId} onChange={(e) => setKeys((k) => ({ ...k, adzunaAppId: e.target.value.trim() }))} aria-label="Adzuna app ID" autoComplete="off" /></label>
          <label className="fld"><span>Adzuna app key</span><input className="input" value={keys.adzunaAppKey} onChange={(e) => setKeys((k) => ({ ...k, adzunaAppKey: e.target.value.trim() }))} aria-label="Adzuna app key" autoComplete="off" /></label>
          <label className="fld"><span>Jooble API key <a href="https://jooble.org/api/about" target="_blank" rel="noreferrer">get a free key</a></span><input className="input" value={keys.joobleKey} onChange={(e) => setKeys((k) => ({ ...k, joobleKey: e.target.value.trim() }))} aria-label="Jooble API key" autoComplete="off" /></label>
        </div>
        <div className="ms-row"><button className="btn" onClick={saveKeys} disabled={busy === "keys"}>{busy === "keys" ? <LoaderCircle className="spin-icon" /> : <Check />}Save keys</button></div>
      </section>

      <section className="ms-card">
        <h3><Bookmark />“Add to JobFinder” button</h3>
        <p className="faint">For ads you find yourself, on any site. Drag the button below into your browser&apos;s bookmarks bar (show it with ⇧⌘B). On a job ad, click it – the ad lands in JobFinder with its full text.</p>
        <div className="ms-row">
          <a ref={mark} className="bookmarklet" onClick={(e) => { e.preventDefault(); toast("Drag it to the bookmarks bar – clicking it here does nothing"); }} title="Drag me to the bookmarks bar">＋ Add to JobFinder</a>
          <span className="faint" style={{ fontSize: 12 }}>Works while JobFinder is running.</span>
        </div>
      </section>

      <section className="ms-card">
        <h3><Globe />Chrome search on portals</h3>
        <p className="faint">JobFinder can also browse portals itself, slowly, like a person. Some don&apos;t allow that.</p>
        <ul className="ms-chrome">
          {(["xing", "linkedin", "stepstone", "indeed"] as const).map((p) => (
            <li key={p}>
              <label className="switch"><input type="checkbox" checked={chrome.on && chrome.portals.includes(p)} onChange={(e) => togglePortal(p, e.target.checked)} aria-label={`Chrome search on ${PORTALS.find((x) => x.key === p)!.name}`} /><span>{PORTALS.find((x) => x.key === p)!.name}</span></label>
              <span className="faint">{CHROME_NOTE[p]}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
