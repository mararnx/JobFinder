import fs from "node:fs";
import path from "node:path";
import { FILES_DIR, get, logEvent, run } from "@/lib/db";
import { claude, renderPrompt } from "@/lib/claude/runner";
import { CvFacts, ReferenceSummary, StyleGuide } from "@/lib/claude/schemas";
import { enqueue, PRIORITY } from "@/lib/queue";
import { setStyleGuide } from "@/lib/profile";
import { all } from "@/lib/db";

export const DOC_KINDS = ["cv", "letter", "ref", "cert", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export function guessKind(name: string): DocKind {
  if (/lebenslauf|\bcv\b|_cv|cv_|resume|résumé|vita/i.test(name)) return "cv";
  if (/anschreiben|cover|motivation|bewerbung/i.test(name)) return "letter";
  if (/zertifikat|certificate|master|bachelor|diplom|abitur|universit|hochschule|degree|urkunde/i.test(name)) return "cert";
  if (/zeugnis|reference|referenz/i.test(name)) return "ref";
  return "other";
}

const SAFE = /[^a-zA-Z0-9._-]+/g;

export function saveUpload(name: string, data: Buffer, kind?: DocKind): number {
  const k = kind ?? guessKind(name);
  const dir = path.join(FILES_DIR, "documents");
  fs.mkdirSync(dir, { recursive: true });
  const stored = path.join(dir, `${Date.now()}-${name.replace(SAFE, "_")}`);
  fs.writeFileSync(stored, data);
  const id = run("INSERT INTO documents(kind, name, path, size, status, attach) VALUES (?, ?, ?, ?, 'reading', ?)", [
    k, name, stored, data.length, k === "ref" || k === "cert" ? 1 : 0,
  ]).lastInsertRowid;
  enqueue("parse_document", { docId: id }, { priority: PRIORITY.parse });
  return id;
}

export async function extractText(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  const buf = fs.readFileSync(file);
  if (ext === ".pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: true });
    return String(text).trim();
  }
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const r = await mammoth.extractRawText({ buffer: buf });
    return r.value.trim();
  }
  if ([".txt", ".md", ".rtf"].includes(ext)) return buf.toString("utf8");
  return "";
}

type Doc = { id: number; kind: DocKind; name: string; path: string };

export async function parseDocument(docId: number) {
  const doc = get<Doc>("SELECT id, kind, name, path FROM documents WHERE id = ?", [docId]);
  if (!doc) return;
  const text = await extractText(doc.path).catch(() => "");
  run("UPDATE documents SET text = ? WHERE id = ?", [text, doc.id]);
  if (!text) {
    run("UPDATE documents SET status = 'done', note = ? WHERE id = ?", [/\.(png|jpe?g|heic|webp)$/i.test(doc.name) ? "Saved (image)" : "Saved – no readable text", doc.id]);
    return;
  }
  if (doc.kind === "cv") {
    const cv = await claude({ name: "parse-cv", model: "sonnet", schema: CvFacts, prompt: renderPrompt("parse-cv", { text: text.slice(0, 30000) }), mockInput: { text } });
    run("UPDATE documents SET status = 'done', parsed_json = ?, note = ? WHERE id = ?", [
      JSON.stringify(cv), `${cv.positions.length} positions, ${cv.facts.length} facts`, doc.id,
    ]);
    logEvent(null, "documents", `CV read: ${cv.facts.length} facts`);
  } else if (doc.kind === "letter") {
    run("UPDATE documents SET status = 'done', note = 'Used for style guide' WHERE id = ?", [doc.id]);
    enqueue("style_guide", {}, { priority: PRIORITY.parse, dedupeKey: "style_guide" });
  } else if (doc.kind === "ref" || doc.kind === "cert") {
    const r = await claude({ name: "reference", model: "haiku", schema: ReferenceSummary, prompt: renderPrompt("reference", { text: text.slice(0, 15000) }), mockInput: { text } });
    run("UPDATE documents SET status = 'done', parsed_json = ?, note = ? WHERE id = ?", [
      JSON.stringify(r), r.rating && r.rating !== "n/a" ? `${r.issuer} · rating: ${r.rating}` : r.issuer, doc.id,
    ]);
  } else {
    run("UPDATE documents SET status = 'done', note = 'Saved' WHERE id = ?", [doc.id]);
  }
}

export async function buildStyleGuide() {
  const letters = all<{ name: string; text: string }>("SELECT name, text FROM documents WHERE kind = 'letter' AND text IS NOT NULL AND text != ''");
  if (!letters.length) return;
  const body = letters.map((l, i) => `<letter n="${i + 1}" file="${l.name}">\n${l.text.slice(0, 6000)}\n</letter>`).join("\n\n");
  const g = await claude({ name: "style-guide", model: "sonnet", schema: StyleGuide, prompt: renderPrompt("style-guide", { letters: body }), mockInput: {} });
  setStyleGuide(g);
}
