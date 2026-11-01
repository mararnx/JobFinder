/**
 * Mock Claude: deterministic, schema-valid answers built from the input with simple heuristics.
 * Used when the Claude Code CLI is not installed (development, tests) or claudeMode = "mock".
 */
import { cleanTitle, detectLanguage, extractEmail, similarity, tokens, truncate } from "@/lib/text";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const delay = () => new Promise((r) => setTimeout(r, Number(process.env.KOMPASS_MOCK_DELAY ?? 150)));
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

function lines(text: string) {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

function requirementLines(desc: string): string[] {
  const ls = lines(desc);
  const i = ls.findIndex((l) => /(profil|anforderung|qualifikation|was du mitbringst|das bringst du mit|requirements|qualifications|what you bring|your profile|you have)/i.test(l));
  const pool = (i >= 0 ? ls.slice(i + 1) : ls).filter((l) => l.startsWith("•") || l.length < 160);
  return pool.slice(0, 6).map((l) => truncate(l.replace(/^[•\-*]\s*/, ""), 90));
}

export async function mockResponse(name: string, input: unknown): Promise<unknown> {
  await delay();
  const i = (input ?? {}) as Any;
  switch (name) {
    case "parse-ad": {
      const text: string = i.text ?? "";
      const ls = lines(text);
      const title = cleanTitle(ls.find((l) => l.length > 4 && l.length < 90 && !/cookie|menu|login|anmelden/i.test(l)) ?? "Job");
      let company = "Unknown company";
      try {
        const host = new URL(i.url).hostname.replace(/^(www|karriere|jobs|careers|career|join)\./, "");
        company = host.split(".").slice(-2, -1)[0] ?? company;
        company = company.charAt(0).toUpperCase() + company.slice(1);
      } catch {
        // pasted text: a short line with a legal form ("Marlin Mobility GmbH, Hamburg") names the company
        const legal = ls.slice(0, 5).find((l) => l.length < 80 && /\b(GmbH|AG|SE|KG|UG|Inc|Ltd|LLC)\b/.test(l));
        if (legal) company = legal.split(/[,·|–]/)[0].trim();
      }
      const loc = text.match(/\b(Berlin|Hamburg|München|Munich|Köln|Cologne|Frankfurt|Stuttgart|Düsseldorf|Leipzig|Hannover|Bremen|Dresden|Nürnberg|Remote)\b/);
      const sal = text.match(/\d{2,3}[.,]?\d{0,3}\s*(?:k|€|EUR)[^\n]{0,30}/);
      return {
        title, company, location: loc?.[1] ?? null,
        remote: /remote|home ?office|mobiles arbeiten/i.test(text) ? (text.match(/(\d)\s*(?:tage|days)[^\n]{0,20}(?:remote|home)/i)?.[0] ?? "remote possible") : null,
        salary_text: sal?.[0]?.trim() ?? null, language: detectLanguage(text), employment_type: /teilzeit|part.time/i.test(text) ? "part-time" : "full-time",
        apply_email: extractEmail(text), apply_url: null, description: text.slice(0, 8000),
      };
    }
    case "score": {
      const kw: string[] = (i.keywords ?? []).map((k: string) => k.toLowerCase());
      const likedText: string = i.liked ?? "";
      const dislikedText: string = i.disliked ?? "";
      return {
        results: (i.ads as Any[]).map((ad) => {
          const blob = `${ad.title} ${ad.description}`.toLowerCase();
          const kwHits = kw.filter((k) => blob.includes(k)).length;
          const titleHit = kw.some((k) => ad.title.toLowerCase().includes(k));
          const like = likedText ? similarity(blob, likedText) : 0.2;
          const dislike = dislikedText ? similarity(blob, dislikedText) : 0;
          const skills = clamp(45 + kwHits * 10 + like * 60);
          const domain = clamp(50 + (like - dislike) * 120);
          const seniority = clamp(/senior|lead|head/i.test(ad.title) ? 78 : /junior|werkstudent|intern|praktik/i.test(ad.title) ? 35 : 70);
          const location = clamp(ad.remote ? 85 : ad.location ? 70 : 60);
          const conditions = clamp(ad.salary_min ? 78 : 60) - (ad.is_agency ? 25 : 0);
          const score = clamp(skills * 0.32 + domain * 0.24 + seniority * 0.16 + location * 0.14 + conditions * 0.14 + (titleHit ? 6 : -4));
          const matched = kw.filter((k) => blob.includes(k)).slice(0, 3);
          return {
            id: ad.id, score, dimensions: { skills, seniority, domain, location, conditions },
            reasons_for: [
              matched.length ? `Matches your keywords: ${matched.join(", ")}` : "Related field, some overlap with your CV",
              ad.remote ? `Remote policy: ${ad.remote}` : `Located in ${ad.location ?? "unknown location"}`,
            ],
            reasons_against: [
              ...(kwHits === 0 ? ["None of your search keywords appear in the ad"] : []),
              ...(seniority < 50 ? ["Level looks too junior for your CV"] : []),
              ...(dislike > like ? ["Resembles ads you rejected before"] : []),
            ].slice(0, 2),
            red_flags: [...(!ad.salary_min ? ["Salary not stated"] : []), ...(ad.is_agency ? ["Posted by a recruiter"] : []), ...(ad.repost_count > 0 ? [`Reposted ${ad.repost_count}×`] : [])],
            language: detectLanguage(ad.description ?? ""),
            apply_channel: extractEmail(ad.description ?? "") ? "email" : "ats_form",
            summary: truncate(`${ad.title} at ${ad.company}`, 80),
          };
        }),
      };
    }
    case "initial-profile":
    case "reflect-profile": {
      const base: string = i.profile ?? "## Wants\n- Roles similar to the ads you liked\n\n## Avoids\n- Roles similar to the ads you rejected\n\n## Dealbreakers\n- See hard filters\n\n## Open questions\n- Company size preference";
      const reasons: string[] = (i.reasons ?? []).filter(Boolean);
      const learned = reasons.length ? `\n- Rejected for: ${[...new Set(reasons)].slice(0, 4).join(", ")}` : "";
      const md = name === "initial-profile"
        ? `## Wants\n${(i.likedTitles ?? []).slice(0, 5).map((t: string) => `- Roles like “${t}”`).join("\n") || "- Roles matching the search keywords"}\n\n## Avoids\n${(i.dislikedTitles ?? []).slice(0, 5).map((t: string) => `- Roles like “${t}”`).join("\n") || "- Nothing stated yet"}\n\n## Dealbreakers\n${i.filters ?? "- None"}\n\n## Open questions\n- Preferred company size and stage`
        : base.replace(/## Avoids\n/, `## Avoids\n${learned.trim() ? learned.trim() + "\n" : ""}`);
      return { markdown: md, diff_summary: name === "initial-profile" ? "First version" : reasons.length ? `Learned from ${reasons.length} rejection reasons` : "No new patterns" };
    }
    case "parse-cv": {
      const text: string = i.text ?? "";
      const ls = lines(text);
      const isContact = (l: string) => /@|\+\d{2}|\bTel\b|linkedin\.com/i.test(l);
      const isHeader = (l: string) => /^(berufserfahrung|erfahrung|experience|ausbildung|education|kenntnisse|skills|sprachen|languages|zertifikate|certificates|profil|profile)$/i.test(l);
      const DATE = /((?:\d{2}\/)?\d{4})\s*[–-]\s*((?:\d{2}\/)?\d{4}|heute|today|present|now)/i;
      const positions: Any[] = [], education: Any[] = [];
      let section = "", cur: Any | null = null;
      for (const l of ls.slice(1)) {
        if (isHeader(l)) { section = l.toLowerCase(); cur = null; continue; }
        const d = l.match(DATE);
        if (d && /ausbildung|education/.test(section)) {
          const [degree, institution] = l.replace(DATE, "").split(",").map((x) => x.trim());
          education.push({ institution: institution ?? "", degree: degree ?? l, start: d[1], end: d[2] });
        } else if (d) {
          const [title, company, location] = l.replace(DATE, "").split(",").map((x) => x.trim()).filter(Boolean);
          cur = { company: company ?? "", title: title ?? "", start: d[1], end: d[2], location: location ?? null, bullets: [] };
          positions.push(cur);
        } else if (cur && (/^[•\-*–]/.test(l) || /erfahrung|experience/.test(section)) && !isContact(l)) cur.bullets.push(l.replace(/^[•\-*–]\s*/, ""));
      }
      const si = ls.findIndex((l) => /^(kenntnisse|skills)$/i.test(l));
      const skillLine = si < 0 ? "" : ls.slice(si + 1, si + 4).join(" ").split(/\s*(?:Sprachen|Languages)\b/)[0].replace(/-\s+/g, "-");
      const facts = [
        ...positions.map((p) => `${p.title} at ${p.company}, ${p.start}–${p.end}`),
        ...positions.flatMap((p) => p.bullets.map((b: string) => `${b} (${p.company})`)),
        ...education.map((e) => `${e.degree}, ${e.institution}`),
      ];
      const headline = (ls[1] ?? "").split("·").map((x) => x.trim()).filter((x) => x && !isContact(x) && !/^(hamburg|berlin|münchen)$/i.test(x)).join(" · ");
      return {
        name: ls[0]?.slice(0, 60) ?? "", email: extractEmail(text), phone: text.match(/\+\d{2}[\d\s/-]{7,}\d/)?.[0] ?? null, address: null,
        headline, positions, education,
        skills: skillLine ? skillLine.split(/,\s*/).filter(Boolean) : [...new Set(tokens(text).filter((t) => t.length > 3))].slice(0, 15),
        languages: ls.filter((l) => /\((muttersprache|native|fließend|verhandlungssicher|fluent)/i.test(l)).flatMap((l) => l.split(/,\s*/)),
        certifications: [],
        facts: (facts.length ? facts : ls.filter((l) => !isContact(l) && !isHeader(l) && l.length > 30).slice(0, 30)).map((t, n) => ({ id: `f${n + 1}`, text: t })),
      };
    }
    case "style-guide":
      return {
        markdown: "- Direct opening that names something specific about the company\n- Short sentences, active voice\n- Achievements with numbers, no adjectives stacked\n- Closes with a plain request for a conversation",
        banned_phrases: ["Hiermit bewerbe ich mich", "mit großem Interesse", "hochmotiviert", "teamfähig", "belastbar", "Ihre Stellenanzeige hat mich sofort angesprochen", "I am excited to apply", "passionate", "dynamic team", "fast-paced environment", "I believe I would be a great fit", "synergy", "go-getter", "think outside the box", "Sehr geehrte Damen und Herren"],
      };
    case "reference": {
      const t: string = i.text ?? "";
      const rating = /vollsten zufriedenheit|stets.{0,20}vollsten/i.test(t) ? "sehr gut" : /stets.{0,20}vollen zufriedenheit/i.test(t) ? "gut" : /vollen zufriedenheit/i.test(t) ? "befriedigend" : "n/a";
      return { issuer: lines(t)[0]?.slice(0, 60) ?? "Unknown", period: t.match(/\d{2}\/\d{4}\s*[-–]\s*\d{2}\/\d{4}/)?.[0] ?? "", rating, highlights: [] };
    }
    case "company-brief":
      return { markdown: `**${i.company}**\n\n${truncate(String(i.material ?? "").replace(/\s+/g, " "), 500) || "No public material found."}\n\n*Mock brief – real briefs are written by Claude.*` };
    case "draft": {
      const job = i.job as Any, de = i.language === "de";
      const facts: Any[] = i.facts ?? [];
      const picked = facts.slice(0, 3);
      const contact = job.contact ?? null;
      const salutation = de ? (contact ? `Sehr geehrte/r ${contact},` : "Guten Tag,") : contact ? `Dear ${contact},` : "Dear hiring team,";
      const body = de
        ? [
            `die Rolle als ${job.title} bei ${job.company} passt genau zu dem, woran ich in den letzten Jahren gearbeitet habe.`,
            picked.length ? `Konkret: ${picked.map((f) => f.text).join(". ")}.` : "In meinen bisherigen Stationen habe ich Verantwortung für ähnliche Aufgaben übernommen.",
            `Was mich an ${job.company} reizt, ist die Möglichkeit, diese Erfahrung in einem Umfeld einzubringen, das Sie in Ihrer Anzeige sehr klar beschreiben.`,
            "Über ein Gespräch freue ich mich.",
          ]
        : [
            `The ${job.title} role at ${job.company} lines up closely with what I have been doing over the last few years.`,
            picked.length ? `Specifically: ${picked.map((f) => f.text).join(". ")}.` : "In my previous roles I took responsibility for similar work.",
            `What draws me to ${job.company} is the chance to bring that experience to the setting your ad describes.`,
            "I would welcome a conversation.",
          ];
      const closing = de ? "Mit freundlichen Grüßen" : "Kind regards";
      const reqs = requirementLines(job.description ?? "");
      return {
        language: de ? "de" : "en",
        subject: de ? `Bewerbung als ${job.title}` : `Application: ${job.title}`,
        recipient_name: contact,
        letter: [salutation, ...body, `${closing}\n${i.name || "—"}`].join("\n\n"),
        email_body: de ? `Guten Tag,\n\nanbei sende ich Ihnen meine Bewerbung als ${job.title}. Für Rückfragen bin ich gern erreichbar.\n\nMit freundlichen Grüßen\n${i.name}` : `Hello,\n\nplease find attached my application for the ${job.title} role. I am happy to answer any questions.\n\nKind regards\n${i.name}`,
        cv_tailoring: { summary: picked[0]?.text ?? "", skill_order: [], highlight_fact_ids: picked.map((f) => f.id) },
        answers: { salary: i.salary || "", start_date: i.start || "", notice_period: i.notice || "", why_us: `${job.company}'s focus matches my experience.` },
        coverage: reqs.map((r, n) => ({ requirement: r, status: n % 3 === 2 ? "partial" : "covered", where: n % 3 === 2 ? "Adjacent experience only" : "Paragraph 2" })),
      };
    }
    case "factcheck": {
      const facts: Any[] = i.facts ?? [];
      const paras = String(i.letter ?? "").split(/\n{2,}/).slice(1, -1); // skip salutation and closing
      const sentences = paras.flatMap((p) => p.split(/(?<=[.!?])\s+/)).filter((s) => /\b(ich|i|my|mein|meine|meinen|mir)\b/i.test(s));
      return {
        claims: sentences.slice(0, 8).map((s) => {
          const best = facts.map((f) => ({ f, sim: similarity(s, f.text) })).sort((a, b) => b.sim - a.sim)[0];
          const status = best && best.sim > 0.45 ? "ok" : best && best.sim > 0.2 ? "reworded" : "unsupported";
          return { text: s.trim(), status, fact_id: best && best.sim > 0.2 ? best.f.id : null, note: status === "ok" ? "Matches the fact base" : status === "reworded" ? "Loosely matches a fact" : "No matching fact found" };
        }),
      };
    }
    case "prep-pack": {
      const job = i.job as Any;
      return { markdown: `## ${job.title} · ${job.company}\n\n### Likely questions\n- Tell us about a product decision you are proud of.\n- How do you prioritise with limited capacity?\n- Why ${job.company}?\n\n### Your stories\n${(i.facts ?? []).slice(0, 5).map((f: Any) => `- ${f.text}`).join("\n")}\n\n### Questions to ask\n- What does success look like after 6 months?\n- How is the team set up?\n\n*Mock prep pack – real packs are written by Claude.*` };
    }
    case "follow-up": {
      const job = i.job as Any, de = i.language === "de";
      return de
        ? { subject: `Nachfrage: Bewerbung als ${job.title}`, body: `Guten Tag,\n\nvor ${i.days} Tagen habe ich mich als ${job.title} beworben und wollte kurz nach dem Stand fragen. Die Rolle interessiert mich weiterhin sehr. Können Sie mir sagen, wie der weitere Zeitplan aussieht?\n\nMit freundlichen Grüßen\n${i.name}` }
        : { subject: `Follow-up: ${job.title} application`, body: `Hello,\n\nI applied for the ${job.title} role ${i.days} days ago and wanted to check in on the status. I am still very interested. Could you share the expected timeline?\n\nKind regards\n${i.name}` };
    }
    default:
      throw new Error(`no mock for prompt ${name}`);
  }
}
