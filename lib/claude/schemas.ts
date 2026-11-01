import { z } from "zod";

const str = z.string();
const strArr = z.array(z.string());

export const ParsedAd = z.object({
  title: str,
  company: str,
  location: str.nullable().optional(),
  remote: str.nullable().optional(),
  salary_text: str.nullable().optional(),
  language: z.enum(["de", "en"]).catch("de"),
  employment_type: str.nullable().optional(),
  apply_email: str.nullable().optional(),
  apply_url: str.nullable().optional(),
  description: str,
});
export type ParsedAd = z.infer<typeof ParsedAd>;

const n100 = z.number().min(0).max(100);

export const ScoreItem = z.object({
  id: z.number(),
  score: n100,
  dimensions: z.object({ skills: n100, seniority: n100, domain: n100, location: n100, conditions: n100 }),
  reasons_for: strArr,
  reasons_against: strArr,
  red_flags: strArr,
  language: z.enum(["de", "en"]).catch("de"),
  apply_channel: z.enum(["email", "ats_form", "portal"]).catch("portal"),
  summary: str,
});
export const ScoreBatch = z.object({ results: z.array(ScoreItem) });
export type ScoreItem = z.infer<typeof ScoreItem>;

export const ProfileDoc = z.object({ markdown: str, diff_summary: str.optional().default("") });

export const CvFacts = z.object({
  name: str,
  email: str.nullable().optional(),
  phone: str.nullable().optional(),
  address: str.nullable().optional(),
  headline: str,
  positions: z.array(z.object({ company: str, title: str, start: str, end: str, location: str.nullable().optional(), bullets: strArr })),
  education: z.array(z.object({ institution: str, degree: str, start: str.nullable().optional(), end: str.nullable().optional() })),
  skills: strArr,
  languages: strArr,
  certifications: strArr,
  facts: z.array(z.object({ id: str, text: str })),
});
export type CvFacts = z.infer<typeof CvFacts>;

export const StyleGuide = z.object({ markdown: str, banned_phrases: strArr });

export const ReferenceSummary = z.object({ issuer: str, period: str, rating: str, highlights: strArr });

export const CompanyBrief = z.object({ markdown: str });

export const Draft = z.object({
  language: z.enum(["de", "en"]),
  subject: str,
  recipient_name: str.nullable().optional(),
  letter: str,
  email_body: str,
  cv_tailoring: z.object({ summary: str, skill_order: strArr, highlight_fact_ids: strArr }),
  answers: z.object({ salary: str, start_date: str, notice_period: str, why_us: str }),
  coverage: z.array(z.object({ requirement: str, status: z.enum(["covered", "partial", "missing"]), where: str })),
});
export type Draft = z.infer<typeof Draft>;

export const FactCheck = z.object({
  claims: z.array(z.object({ text: str, status: z.enum(["ok", "reworded", "unsupported"]), fact_id: str.nullable().optional(), note: str })),
});
export type FactCheck = z.infer<typeof FactCheck>;

export const PrepPack = z.object({ markdown: str });

export const FollowUp = z.object({ subject: str, body: str });
