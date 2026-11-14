// server.js — local test backend + web app for "share from Instagram"
// No dependencies. Run with:  node server.js   (optional: PORT=4000 node server.js)
//
// Endpoints
//   GET  /                 web app (installable PWA)
//   POST /share            iPhone Shortcut / web app: {"url": "...", "token": "..."} (JSON or plain text)
//   GET  /share-target     Android share sheet (Web Share Target) -> saves, then redirects to /
//   GET  /reels            everything shared so far, newest first (?token=me to filter)
//   DELETE /reels/:id      remove one
//   GET  /config           LAN addresses, for the setup instructions in the page

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const reels = []; // in-memory store, resets when the server restarts

// ---------- helpers ----------

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    ...headers,
  });
  res.end(status === 204 ? undefined : JSON.stringify(data));
}

// Pull the first instagram.com link out of whatever was shared.
// Android shares often arrive as "Check out this reel https://www.instagram.com/reel/...".
function extractInstagramUrl(text) {
  const match = String(text || "").match(/https?:\/\/(?:www\.|m\.)?instagram\.com\/[^\s"'<>]+/i);
  if (!match) return null;
  return match[0].replace(/[).,]+$/, "");
}

function reelIdFromUrl(url) {
  const m = url.match(/instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

function saveReel({ text, token, via }) {
  const url = extractInstagramUrl(text);
  if (!url) return { error: "No instagram.com link found" };

  const shortcode = reelIdFromUrl(url);
  const owner = String(token || "me").trim() || "me";
  const existing = reels.find((r) => r.token === owner && (shortcode ? r.shortcode === shortcode : r.url === url));
  if (existing) return { reel: existing, duplicate: true };

  const reel = {
    id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    url,
    shortcode,
    token: owner,
    via, // shortcut | android-share | web-paste | test
    savedAt: new Date().toISOString(),
    status: "queued",
  };
  reels.unshift(reel);
  fakeProcess(reel);
  return { reel };
}

// Stand-in for the real worker so the UI can show the status flow.
function fakeProcess(reel) {
  const steps = ["downloading", "processing", "ready"];
  steps.forEach((s, i) => setTimeout(() => (reel.status = s), 2500 * (i + 1)));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(body));
  });
}

function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === "IPv4" && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

// ---------- PNG icons generated at startup (no image files needed) ----------

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Brand-blue square with a white "brain bubble" (circle) and an orange dot.
function makeIcon(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2, r = size * 0.3, dotR = size * 0.09;
  const dotX = c + r * 0.72, dotY = c - r * 0.72;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let px = [47, 91, 255]; // #2F5BFF
      const d = Math.hypot(x - c, y - c);
      if (d < r) px = [255, 255, 255];
      if (d < r * 0.45) px = [47, 91, 255];
      if (Math.hypot(x - dotX, y - dotY) < dotR) px = [255, 122, 47]; // #FF7A2F
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const ICONS = { "/icon-192.png": makeIcon(192), "/icon-512.png": makeIcon(512) };

// ---------- static files ----------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".css": "text/css; charset=utf-8",
};

function serveStatic(res, pathname) {
  if (ICONS[pathname]) {
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
    return res.end(ICONS[pathname]);
  }
  const file = pathname === "/" ? "/index.html" : pathname;
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, { ok: false });
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, { ok: false, error: "Not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(data);
  });
}

// ---------- routes ----------

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") return send(res, 204);

  if (req.method === "GET" && pathname === "/reels") {
    const token = searchParams.get("token");
    return send(res, 200, token ? reels.filter((r) => r.token === token) : reels);
  }

  if (req.method === "GET" && pathname === "/config") {
    return send(res, 200, { port: PORT, addresses: lanAddresses() });
  }

  if (req.method === "DELETE" && pathname.startsWith("/reels/")) {
    const i = reels.findIndex((r) => r.id === pathname.slice("/reels/".length));
    if (i === -1) return send(res, 404, { ok: false });
    reels.splice(i, 1);
    return send(res, 200, { ok: true });
  }

  // iPhone Shortcut and the web app's paste box
  if (req.method === "POST" && pathname === "/share") {
    const body = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = { url: body }; // plain-text body
    }
    if (typeof payload !== "object" || payload === null) payload = { url: String(payload) };
    const text = [payload.url, payload.text, payload.title, body].filter(Boolean).join(" ");
    const result = saveReel({ text, token: payload.token, via: payload.via || "shortcut" });
    if (result.error) {
      console.log("Rejected share, no Instagram link found. Raw body:", body);
      return send(res, 400, { ok: false, error: result.error });
    }
    console.log(result.duplicate ? "Duplicate share:" : "Saved reel:", result.reel.url, `(${result.reel.via}, token=${result.reel.token})`);
    return send(res, 200, { ok: true, duplicate: !!result.duplicate, reel: result.reel });
  }

  // Android share sheet (manifest share_target, method GET)
  if (req.method === "GET" && pathname === "/share-target") {
    const text = ["url", "text", "title"].map((k) => searchParams.get(k)).filter(Boolean).join(" ");
    // The share sheet can't add a token, so the page stores it in a cookie.
    const cookieToken = (req.headers.cookie || "").match(/(?:^|;\s*)brain_token=([^;]+)/);
    const token = searchParams.get("token") || (cookieToken && decodeURIComponent(cookieToken[1]));
    const result = saveReel({ text, token, via: "android-share" });
    const status = result.error ? "error" : result.duplicate ? "duplicate" : "saved";
    console.log(`Android share -> ${status}:`, text);
    res.writeHead(303, { Location: `/?shared=${status}` });
    return res.end();
  }

  if (req.method === "GET") return serveStatic(res, pathname);

  send(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`  On this computer: http://localhost:${PORT}`);
  console.log("  From your phone (same Wi-Fi):");
  for (const a of lanAddresses()) console.log(`    ${a}`);
  console.log("  Android install + share sheet needs HTTPS: run `npx ngrok http " + PORT + "` and open the https URL.");
});
