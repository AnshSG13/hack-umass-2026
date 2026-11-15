// Server-side read of GET /api/config, for the few places that render before the browser
// can ask: the tab title, the Home Screen name and the web app manifest.

const API = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

/** The app name from the API. "Reelize" is only the fallback while the API can't be reached. */
export async function appNameServer(): Promise<string> {
  try {
    const res = await fetch(`${API}/api/config`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = (await res.json()) as { app_name?: unknown };
      if (typeof data.app_name === "string" && data.app_name.trim()) return data.app_name.trim();
    }
  } catch {
    /* the API isn't up (for example during an image build) */
  }
  return "Reelize";
}
