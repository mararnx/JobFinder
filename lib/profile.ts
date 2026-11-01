import { all, get, json, run } from "@/lib/db";
import type { CvFacts } from "@/lib/claude/schemas";
import { meta, setMeta } from "@/lib/queue";

export function currentProfile(): { version: number; markdown: string; diff_summary: string | null; created_by: string; created_at: string } | null {
  return get("SELECT version, markdown, diff_summary, created_by, created_at FROM profile_versions ORDER BY version DESC LIMIT 1") ?? null;
}

export function profileHistory() {
  return all<{ version: number; diff_summary: string | null; created_by: string; created_at: string }>(
    "SELECT version, diff_summary, created_by, created_at FROM profile_versions ORDER BY version DESC LIMIT 50",
  );
}

export function saveProfile(markdown: string, by: "you" | "claude", diff: string): number {
  const v = (currentProfile()?.version ?? 0) + 1;
  run("INSERT INTO profile_versions(version, markdown, diff_summary, created_by) VALUES (?, ?, ?, ?)", [v, markdown.trim(), diff, by]);
  return v;
}

export function cvFacts(): CvFacts | null {
  const row = get<{ parsed_json: string }>(
    "SELECT parsed_json FROM documents WHERE kind = 'cv' AND status = 'done' AND parsed_json IS NOT NULL ORDER BY (name LIKE '%.doc%') DESC, id DESC LIMIT 1",
  );
  return row ? json<CvFacts | null>(row.parsed_json, null) : null;
}

export function factBase(): string {
  const cv = cvFacts();
  if (!cv) return "(no CV uploaded yet)";
  const refs = all<{ parsed_json: string }>("SELECT parsed_json FROM documents WHERE kind IN ('ref','cert') AND status = 'done' AND parsed_json IS NOT NULL")
    .map((r) => json<{ issuer: string; rating: string; highlights: string[] } | null>(r.parsed_json, null))
    .filter(Boolean)
    .map((r, i) => `r${i + 1}: Reference/certificate from ${r!.issuer}: rating ${r!.rating}. ${r!.highlights.join("; ")}`);
  return [...cv.facts.map((f) => `${f.id}: ${f.text}`), ...refs].join("\n");
}

export function cvSummary(): string {
  const cv = cvFacts();
  if (!cv) return "(no CV uploaded yet)";
  const pos = cv.positions.slice(0, 6).map((p) => `- ${p.title}, ${p.company} (${p.start}–${p.end})`).join("\n");
  return `${cv.headline}\n${pos}\nSkills: ${cv.skills.slice(0, 25).join(", ")}\nLanguages: ${cv.languages.join(", ")}`;
}

export type StyleGuide = { markdown: string; banned_phrases: string[] };

export function styleGuide(): StyleGuide | null {
  const v = meta("styleGuide");
  return v ? (JSON.parse(v) as StyleGuide) : null;
}

export function setStyleGuide(g: StyleGuide) {
  setMeta("styleGuide", JSON.stringify(g));
}

export function searchKeywords(): string[] {
  const rows = all<{ keywords: string }>("SELECT keywords FROM search_profiles WHERE enabled = 1");
  return [...new Set(rows.flatMap((r) => json<string[]>(r.keywords, [])).map((k) => k.trim()).filter(Boolean))];
}

export function searchProfiles() {
  return all<{ id: number; name: string; keywords: string; location: string; radius_km: number; enabled: number }>("SELECT * FROM search_profiles ORDER BY id").map((p) => ({
    ...p,
    keywords: json<string[]>(p.keywords, []),
  }));
}
