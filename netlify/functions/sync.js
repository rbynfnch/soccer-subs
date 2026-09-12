import { getStore } from "@netlify/blobs";

// Simple shared key/value sync endpoint for the Sub Tracker app.
// GET  /api/sync?code=ABC123      -> returns the last-saved { state, updatedAt, deviceId } for that game code
// POST /api/sync?code=ABC123      -> body is { state, updatedAt, deviceId, baseUpdatedAt }, saved under that code
//
// Codes are short, human-typeable strings the coach shares with assistants.
// There is no auth beyond "you know the code" — fine for a trusted small group,
// not intended to keep out a determined stranger.
//
// POST is optimistic-concurrency-checked: a write is only accepted when the
// client's baseUpdatedAt matches what's actually stored. Otherwise some other
// device changed the game since this client last saw it, and blindly storing
// this client's copy would silently erase that change — so we reject with 409
// and hand back the current version for the client to merge and retry.

const CODE_RE = /^[A-Z0-9]{4,10}$/;
const MAX_BYTES = 900000; // stay well under Netlify Blobs' per-value limits

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();

  if (!CODE_RE.test(code)) {
    return jsonResponse({ error: "Invalid or missing game code" }, 400);
  }

  const store = getStore("soccer-sub-tracker-games");

  if (req.method === "GET") {
    const data = await store.get(code, { type: "json" });
    return jsonResponse(data || null);
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    const json = JSON.stringify(body);
    if (json.length > MAX_BYTES) {
      return jsonResponse({ error: "Payload too large" }, 413);
    }

    const existing = await store.get(code, { type: "json" });
    const baseUpdatedAt = typeof body.baseUpdatedAt === "number" ? body.baseUpdatedAt : 0;
    const existingUpdatedAt = existing && typeof existing.updatedAt === "number" ? existing.updatedAt : 0;
    if (existing && baseUpdatedAt !== existingUpdatedAt) {
      return jsonResponse({ conflict: true, state: existing.state, updatedAt: existing.updatedAt }, 409);
    }

    await store.setJSON(code, body);
    return jsonResponse({ ok: true, updatedAt: body.updatedAt });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/sync" };
