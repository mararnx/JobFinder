import fs from "node:fs";
import path from "node:path";
import { get } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Serves an application bundle or an uploaded document by id (never arbitrary paths). */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  let file: string | undefined;
  if (p.get("app")) file = get<{ bundle_path: string }>("SELECT bundle_path FROM applications WHERE id = ?", [Number(p.get("app"))])?.bundle_path;
  else if (p.get("doc")) file = get<{ path: string }>("SELECT path FROM documents WHERE id = ?", [Number(p.get("doc"))])?.path;
  if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const name = path.basename(file).replace(/^\d+-/, "");
  const type = /\.pdf$/i.test(name) ? "application/pdf" : "application/octet-stream";
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": type, "Content-Disposition": `${p.get("download") ? "attachment" : "inline"}; filename="${encodeURIComponent(name)}"` },
  });
}
