const TILE_COLORS = ["#1F6F5C", "#3A4FBF", "#B4462B", "#6B3FA0", "#0E7490", "#4D5B1F", "#A1306B", "#2C6E9E", "#3F3F46", "#166534", "#7C4A1E", "#9D3D3D"];

export function tileColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s&-]/gu, "").split(/[\s-]+/).filter((w) => w && !/^(gmbh|ag|se|kg|und|&|the|of)$/i.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function scoreColor(s: number | null | undefined): string {
  if (s == null) return "var(--text-3)";
  return s >= 80 ? "var(--accent-fg)" : s >= 70 ? "var(--info)" : "var(--text-3)";
}

/** SQLite datetime('now') strings are UTC without a zone marker. */
export function parseDb(d: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(d) || d.length <= 10 ? d : d.replace(" ", "T") + "Z");
}

export function timeAgo(d: string | null | undefined): string {
  if (!d) return "";
  const s = (Date.now() - parseDb(d)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function daysSince(d: string | null | undefined): number {
  return d ? Math.max(0, Math.floor((Date.now() - parseDb(d)) / 86_400_000)) : 0;
}

export function fmtSalary(min: number | null, max: number | null, text: string | null): string {
  if (min && max) return min === max ? `CHF ${Math.round(min / 1000)}k` : `CHF ${Math.round(min / 1000)}–${Math.round(max / 1000)}k`;
  return text ? text.slice(0, 24) : "n/a";
}

export function clockTime(d: string): string {
  return new Date(parseDb(d)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
