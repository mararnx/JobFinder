import { NextResponse } from "next/server";
import { saveUpload, type DocKind } from "@/lib/pipeline/documents";

export const dynamic = "force-dynamic";
const MAX = 25 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData();
  const kind = (form.get("kind") as DocKind | null) || undefined;
  const ids: number[] = [];
  const skipped: string[] = [];
  for (const f of form.getAll("files")) {
    if (!(f instanceof File)) continue;
    if (f.size > MAX) {
      skipped.push(`${f.name} (over 25 MB)`);
      continue;
    }
    ids.push(saveUpload(f.name, Buffer.from(await f.arrayBuffer()), kind));
  }
  return NextResponse.json({ ok: true, ids, skipped });
}
