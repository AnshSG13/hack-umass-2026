import { existsSync } from "node:fs";
import { join } from "node:path";
import { Landing } from "@/components/landing";

// DESIGN.md 7.1: if /landing.mp4 exists the hero is that clip, otherwise a real ticket.
// Checked once at build time so the browser never asks for a file that isn't there.
export default function Page() {
  const hasClip = existsSync(join(process.cwd(), "public", "landing.mp4"));
  return <Landing hasClip={hasClip} />;
}
