import { all } from "@/lib/db";
import { cvFacts, styleGuide } from "@/lib/profile";
import { DocumentsClient, type Doc } from "./DocumentsClient";

export const dynamic = "force-dynamic";

export default function Documents() {
  const docs = all<Doc>("SELECT id, kind, name, size, status, note, attach FROM documents ORDER BY id");
  const cv = cvFacts();
  const sg = styleGuide();
  const attachBytes = docs.filter((d) => d.attach && /\.pdf$/i.test(d.name)).reduce((a, d) => a + d.size, 0);
  return <DocumentsClient docs={docs} facts={cv?.facts.length ?? 0} positions={cv?.positions.length ?? 0} style={sg?.markdown ?? null} letters={docs.filter((d) => d.kind === "letter").length} attachBytes={attachBytes} />;
}
