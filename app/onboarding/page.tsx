import { all, getSettings } from "@/lib/db";
import { claudeCli, isMock } from "@/lib/claude/runner";
import { searchProfiles } from "@/lib/profile";
import { Onboarding } from "./Onboarding";

export const dynamic = "force-dynamic";

export default function Page() {
  const docs = all<{ id: number; kind: string; name: string; status: string; note: string | null }>("SELECT id, kind, name, status, note FROM documents ORDER BY id");
  const cli = claudeCli();
  return <Onboarding settings={getSettings()} docs={docs} profiles={searchProfiles()} claude={{ cli: cli.ok ? cli.version ?? "installed" : null, mock: isMock() }} />;
}
