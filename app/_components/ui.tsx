import { initials, scoreColor, tileColor } from "@/lib/ui";

export function Ring({ score, size = 44, stroke = 3.5, label = true }: { score: number | null; size?: number; stroke?: number; label?: boolean }) {
  const s = score ?? 0;
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const fs = size > 60 ? 22 : size > 40 ? 13 : 11;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={score == null ? "Not scored yet" : `Match ${s} of 100`}>
      <svg width={size} height={size}>
        <circle className="track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="bar" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke={scoreColor(score)} strokeDasharray={c} strokeDashoffset={c * (1 - s / 100)} />
      </svg>
      {label && <span className="val" style={{ fontSize: fs }}>{score ?? "–"}</span>}
    </div>
  );
}

export function Tile({ name, small }: { name: string; small?: boolean }) {
  return (
    <div className={`mono-tile${small ? " sm" : ""}`} style={{ background: tileColor(name) }} aria-hidden="true">
      {initials(name)}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd>{children}</kbd>;
}

/** Minimal Markdown → JSX for briefs, profiles and prep packs (headings, lists, bold/italic, paragraphs). */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string, k: string) => {
    const parts = s.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    return parts.map((p, i) =>
      p.startsWith("**") ? <b key={k + i}>{p.slice(2, -2)}</b> : p.startsWith("*") && p.length > 2 ? <em key={k + i}>{p.slice(1, -1)}</em> : p.startsWith("`") ? <code key={k + i}>{p.slice(1, -1)}</code> : p,
    );
  };
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`}>{list.map((l, i) => <li key={i}>{inline(l, `li${i}`)}</li>)}</ul>);
    list = [];
  };
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) return void list.push(li[1]);
    flush();
    if (!line.trim()) return;
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) blocks.push(h[1].length <= 2 ? <h3 key={i}>{inline(h[2], `h${i}`)}</h3> : <h4 key={i}>{inline(h[2], `h${i}`)}</h4>);
    else blocks.push(<p key={i}>{inline(line, `p${i}`)}</p>);
  });
  flush();
  return <div className="md">{blocks}</div>;
}

/** The JobFinder mark: a search lens with a check – a match found. Drawn on the accent tile. */
export function Logo({ big }: { big?: boolean }) {
  return (
    <div className={`brand-mark${big ? " big" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10.5" cy="10.5" r="6" strokeWidth="2.2" />
        <path d="M15 15l4.5 4.5" strokeWidth="2.8" />
        <path d="M8 10.7l1.8 1.8 3.4-3.6" strokeWidth="2" />
      </svg>
    </div>
  );
}
