import { getStore } from "@netlify/blobs";

const HEAD = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: HEAD });
const BAD = ["ควย", "เหี้ย", "สัส", "เย็ด", "ไอ้สัตว์", "fuck", "shit", "bitch"];
const clean = (t) => {
  let s = String(t).replace(/[\u0000-\u001f<>]/g, " ").trim();
  for (const w of BAD) s = s.replace(new RegExp(w, "gi"), "***");
  return s;
};
const sha = async (x) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(x)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export default async (req) => {
  const store = getStore("wishes");
  const rl = getStore("ratelimit");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 60);
    const items = (await Promise.all(keys.map((k) => store.get(k, { type: "json" }))))
      .filter(Boolean)
      .map(({ hash, ...pub }) => pub);
    return J(items);
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return J({ error: "bad json" }, 400); }
    if (!b || (b.type !== "k" && b.type !== "l")) return J({ error: "type" }, 400);
    if (typeof b.secret !== "string" || !/^[0-9a-f]{32}$/.test(b.secret)) return J({ error: "secret" }, 400);
    const name = clean(b.name ?? "").slice(0, 20) || "ผู้ไม่ประสงค์ออกนาม";
    const msg = clean(b.msg ?? "").slice(0, 80) || "ขอให้มีความสุข";

    const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "x";
    const rk = await sha(ip);
    const last = await rl.get(rk, { type: "json" });
    if (last && Date.now() - last.t < 8000) return J({ error: "rate" }, 429);
    await rl.setJSON(rk, { t: Date.now() });

    const id = Date.now().toString(36).padStart(9, "0") + Math.random().toString(36).slice(2, 6);
    const item = {
      id, type: b.type, name, msg,
      t0: Date.now() / 1000,
      fx: num(b.fx, 0.05, 0.95, 0.5),
      sd: num(b.sd, 0, 10, 1),
      drift: num(b.drift, -0.2, 0.2, 0),
      ci: Math.floor(num(b.ci, 0, 3, 0)),
    };
    await store.setJSON(id, { ...item, hash: await sha(b.secret) });

    const { blobs } = await store.list();
    const ks = blobs.map((x) => x.key).sort();
    if (ks.length > 200) await Promise.all(ks.slice(0, ks.length - 200).map((k) => store.delete(k)));
    return J(item, 201);
  }

  if (req.method === "DELETE") {
    const id = url.searchParams.get("id") || "";
    if (!/^[0-9a-z]{10,20}$/.test(id)) return J({ error: "id" }, 400);
    const item = await store.get(id, { type: "json" });
    if (!item) return J({ ok: true });
    const admin = process.env.ADMIN_KEY;
    const isAdmin = !!admin && req.headers.get("x-admin-key") === admin;
    const isOwner = (await sha(req.headers.get("x-secret") || "")) === item.hash;
    if (!isAdmin && !isOwner) return J({ error: "forbidden" }, 403);
    await store.delete(id);
    return J({ ok: true });
  }
  return J({ error: "method" }, 405);
};

export const config = { path: "/api/wishes" };
