export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // D1 binding name must be "DB"
  const db = env.DB;
  if (!db) return json({ error: "D1 binding 'DB' is not configured." }, 500);

  if (request.method === "GET") {
    // /api/patch?code=105A024
    const code = (url.searchParams.get("code") || "").trim();
    if (!code) return json({ error: "missing code" }, 400);

    const row = await db
      .prepare("SELECT patch_json, updated_at, actor FROM question_patch WHERE question_code = ?")
      .bind(code)
      .first();

    if (!row) return json({ patch: null });

    let patch = null;
    try { patch = JSON.parse(row.patch_json); } catch {}
    return json({ patch, meta: { updated_at: row.updated_at, actor: row.actor } });
  }

  if (request.method === "POST") {
    // body: { question_code, actor?, source?, patch }
    let body = null;
    try { body = await request.json(); } catch {}
    if (!body) return json({ error: "invalid json" }, 400);

    const question_code = (body.question_code || "").trim();
    const actor = (body.actor || "").trim() || null;
    const source = (body.source || "ui").trim();
    const patch = body.patch;

    if (!question_code) return json({ error: "missing question_code" }, 400);
    if (!patch || typeof patch !== "object") return json({ error: "missing patch" }, 400);

    const patch_json = JSON.stringify(patch);
    const payload_json = JSON.stringify({ question_code, patch });

    // 1) upsert question_patch
    await db.prepare(`
      INSERT INTO question_patch (question_code, actor, patch_json)
      VALUES (?, ?, ?)
      ON CONFLICT(question_code) DO UPDATE SET
        updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        actor = excluded.actor,
        patch_json = excluded.patch_json
    `).bind(question_code, actor, patch_json).run();

    // 2) append analysis_log
    await db.prepare(`
      INSERT INTO analysis_log (actor, source, action, question_code, payload_json)
      VALUES (?, ?, 'patch_upsert', ?, ?)
    `).bind(actor, source, question_code, payload_json).run();

    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}