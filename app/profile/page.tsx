import { getSettings } from "@/lib/db";
import { currentProfile, profileHistory } from "@/lib/profile";
import { ProfileClient } from "./ProfileClient";

export const dynamic = "force-dynamic";

export default function Profile() {
  return <ProfileClient profile={currentProfile()} history={profileHistory()} settings={getSettings()} />;
}
