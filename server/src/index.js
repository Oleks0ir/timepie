// The friends server: groups of people comparing their weekly donuts.
//
// It only ever holds what each app chose to send — a display name and a few recent
// weeks of totals — never the entries themselves. Every push replaces a member's
// weeks whole, so the server is a mirror of the apps, not a second source of truth.
//
//   POST   /api/groups                       ← { name? } → { code }
//   GET    /api/groups/:code                 → { code, name, members: [...] }
//   PUT    /api/groups/:code                 (Bearer token of any member) ← { name }
//   PUT    /api/groups/:code/members/:id     (Bearer token) ← { name, weeks }
//   PUT    /api/groups/:code/members/:id/live (Bearer token) ← { live: { name, colorSlot, seconds } | null }
//   DELETE /api/groups/:code/members/:id     (Bearer token)
//   GET    /g/:code                          → the leaderboard as a web page
//
// And one board everyone can join, holding only a name and each week's total:
//
//   GET    /api/global/:week?me=:id          → { week, count, top: [{ id, name, total, place }], me }
//   PUT    /api/global/members/:id           (Bearer token) ← { name, weeks: [{ week, total }] }
//   DELETE /api/global/members/:id           (Bearer token)

// Wrangler bundles .html files as plain text.
import page from './page.html';

/** No 0/O or 1/I/L, so a code read aloud or off a screen can't be mistyped. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_MEMBERS = 50;
const MAX_WEEKS = 12;
const MAX_SLICES = 60;
const MAX_NAME = 40;
const MAX_GROUP_NAME = 40;
const MAX_SLICE_NAME = 60;
/** How many places the global board lists. */
const GLOBAL_TOP = 100;
/** A running timer is re-sent every minute; one not heard from in this long has died with its app. */
const LIVE_TIMEOUT_MS = 150 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
const fail = (status, error) => json({ error }, status);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const path = new URL(request.url).pathname.split('/').filter(Boolean);
    try {
      return await route(request, env, path);
    } catch (e) {
      if (e instanceof BadRequest) return fail(400, e.message);
      console.error(e);
      return fail(500, 'Something went wrong on the server.');
    }
  },
};

async function route(request, env, path) {
  const method = request.method;

  if (path[0] === 'g' && path.length === 2 && method === 'GET') {
    return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (path[0] === 'api' && path[1] === 'global') return routeGlobal(request, env, path);
  if (path[0] !== 'api' || path[1] !== 'groups') return fail(404, 'Not found.');

  if (path.length === 2 && method === 'POST') return createGroup(request, env);

  const code = normaliseCode(path[2]);
  if (!code) return fail(404, 'No group has that code.');

  if (path.length === 3 && method === 'GET') return getGroup(env, code);
  if (path.length === 3 && method === 'PUT') return renameGroup(request, env, code);
  if (path.length === 5 && path[3] === 'members') {
    const id = path[4];
    if (!/^[0-9A-Fa-f-]{36}$/.test(id)) return fail(400, 'Bad member id.');
    if (method === 'PUT') return putMember(request, env, code, id.toUpperCase());
    if (method === 'DELETE') return deleteMember(request, env, code, id.toUpperCase());
  }
  if (path.length === 6 && path[3] === 'members' && path[5] === 'live' && method === 'PUT') {
    const id = path[4];
    if (!/^[0-9A-Fa-f-]{36}$/.test(id)) return fail(400, 'Bad member id.');
    return putLive(request, env, code, id.toUpperCase());
  }
  return fail(404, 'Not found.');
}

// MARK: - The global board

async function routeGlobal(request, env, path) {
  const method = request.method;
  if (path.length === 3 && method === 'GET') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(path[2])) return fail(400, 'Bad week.');
    return getGlobal(env, path[2], new URL(request.url).searchParams.get('me')?.toUpperCase());
  }
  if (path.length === 4 && path[2] === 'members') {
    const id = path[3];
    if (!/^[0-9A-Fa-f-]{36}$/.test(id)) return fail(400, 'Bad member id.');
    if (method === 'PUT') return putGlobalMember(request, env, id.toUpperCase());
    if (method === 'DELETE') return deleteGlobalMember(request, env, id.toUpperCase());
  }
  return fail(404, 'Not found.');
}

/** One week's board: the top of it, how many are on it, and where `me` stands. */
async function getGlobal(env, week, me) {
  const [top, count, mine] = await env.DB.batch([
    env.DB.prepare(`SELECT m.id, m.name, w.total FROM global_weeks w JOIN global_members m ON m.id = w.member_id
                    WHERE w.week = ? AND w.total > 0 ORDER BY w.total DESC, m.name COLLATE NOCASE LIMIT ?`)
      .bind(week, GLOBAL_TOP),
    env.DB.prepare('SELECT COUNT(*) AS count FROM global_weeks WHERE week = ? AND total > 0').bind(week),
    env.DB.prepare(`SELECT w.total, (SELECT COUNT(*) FROM global_weeks o WHERE o.week = w.week AND o.total > w.total) AS ahead
                    FROM global_weeks w WHERE w.week = ? AND w.member_id = ? AND w.total > 0`)
      .bind(week, me ?? ''),
  ]);
  // Equal totals share a place.
  let place = 0;
  const rows = top.results.map((r, i) => {
    if (i === 0 || r.total !== top.results[i - 1].total) place = i + 1;
    return { id: r.id, name: r.name, total: r.total, place };
  });
  const m = mine.results[0];
  return json({
    week,
    count: count.results[0].count,
    top: rows,
    me: m ? { total: m.total, place: m.ahead + 1 } : null,
  });
}

async function putGlobalMember(request, env, id) {
  const tokenHash = await hashToken(request);
  if (!tokenHash) return fail(401, 'Missing token.');

  const body = await request.json().catch(() => null);
  const name = cleanName(body?.name, MAX_NAME);
  if (!name) throw new BadRequest('A name is needed.');
  if (!Array.isArray(body?.weeks) || body.weeks.length > MAX_WEEKS) throw new BadRequest('Bad weeks.');
  const weeks = body.weeks.map((w) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w?.week ?? '') || !isMinutes(w.total)) throw new BadRequest('Bad week.');
    return { week: w.week, total: w.total };
  });

  const existing = await env.DB.prepare('SELECT token_hash FROM global_members WHERE id = ?').bind(id).first();
  if (existing && existing.token_hash !== tokenHash) return fail(403, 'That member belongs to someone else.');

  // The weeks are replaced whole, like a group's, so the board mirrors the app.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO global_members (id, token_hash, name, updated_at) VALUES (?, ?, ?, ?)
                    ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`)
      .bind(id, tokenHash, name, new Date().toISOString()),
    env.DB.prepare('DELETE FROM global_weeks WHERE member_id = ?').bind(id),
    ...weeks.map((w) => env.DB.prepare('INSERT INTO global_weeks (member_id, week, total) VALUES (?, ?, ?)')
      .bind(id, w.week, w.total)),
  ]);
  return json({ ok: true });
}

async function deleteGlobalMember(request, env, id) {
  const tokenHash = await hashToken(request);
  if (!tokenHash) return fail(401, 'Missing token.');
  const member = await env.DB.prepare('SELECT token_hash FROM global_members WHERE id = ?').bind(id).first();
  if (member && member.token_hash === tokenHash) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM global_weeks WHERE member_id = ?').bind(id),
      env.DB.prepare('DELETE FROM global_members WHERE id = ?').bind(id),
    ]);
  }
  return json({ ok: true });
}

/** "abc-def", "ABC DEF" and "abcdef" all name the same group. */
function normaliseCode(raw) {
  const code = decodeURIComponent(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

async function createGroup(request, env) {
  const body = await request.json().catch(() => null);
  const name = cleanName(body?.name, MAX_GROUP_NAME);
  // A collision is about one in a billion, but retrying costs nothing.
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    const code = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
    const { meta } = await env.DB
      .prepare('INSERT OR IGNORE INTO groups (code, name, created_at) VALUES (?, ?, ?)')
      .bind(code, name, new Date().toISOString())
      .run();
    if (meta.changes === 1) return json({ code }, 201);
  }
  return fail(500, 'Could not make a group code. Try again.');
}

async function getGroup(env, code) {
  const group = await env.DB.prepare('SELECT code, name FROM groups WHERE code = ?').bind(code).first();
  if (!group) return fail(404, 'No group has that code.');
  const { results } = await env.DB
    .prepare('SELECT id, name, weeks, updated_at, live, live_since, live_seen FROM members WHERE group_code = ?')
    .bind(code)
    .all();
  const now = Date.now();
  return json({
    code,
    name: group.name ?? null,
    members: results.map((m) => ({
      id: m.id, name: m.name, weeks: JSON.parse(m.weeks), updatedAt: m.updated_at, live: liveOf(m, now),
    })),
  });
}

/**
 * A member's running timer, with how long it's been going by the server's clock, so
 * nobody's clock has to agree with anybody else's.
 */
function liveOf(m, now) {
  if (!m.live || !m.live_since || !m.live_seen) return null;
  if (now - Date.parse(m.live_seen) > LIVE_TIMEOUT_MS) return null;
  const { name, colorSlot } = JSON.parse(m.live);
  return { name, colorSlot, seconds: Math.max(0, Math.floor((now - Date.parse(m.live_since)) / 1000)) };
}

/** Anyone in the group can name it, or clear the name with an empty one. */
async function renameGroup(request, env, code) {
  const tokenHash = await hashToken(request);
  if (!tokenHash) return fail(401, 'Missing token.');
  const group = await env.DB.prepare('SELECT code FROM groups WHERE code = ?').bind(code).first();
  if (!group) return fail(404, 'No group has that code.');
  const member = await env.DB
    .prepare('SELECT id FROM members WHERE group_code = ? AND token_hash = ?')
    .bind(code, tokenHash)
    .first();
  if (!member) return fail(403, 'Only people in the group can rename it.');

  const body = await request.json().catch(() => null);
  if (typeof body?.name !== 'string') throw new BadRequest('A name is needed.');
  const name = cleanName(body.name, MAX_GROUP_NAME);
  await env.DB.prepare('UPDATE groups SET name = ? WHERE code = ?').bind(name, code).run();
  return json({ name });
}

async function putMember(request, env, code, id) {
  const tokenHash = await hashToken(request);
  if (!tokenHash) return fail(401, 'Missing token.');

  const group = await env.DB.prepare('SELECT code FROM groups WHERE code = ?').bind(code).first();
  if (!group) return fail(404, 'No group has that code.');

  const body = await request.json().catch(() => null);
  const name = cleanName(body?.name, MAX_NAME);
  if (!name) throw new BadRequest('A name is needed.');
  const weeks = cleanWeeks(body?.weeks);

  const existing = await env.DB
    .prepare('SELECT token_hash FROM members WHERE group_code = ? AND id = ?')
    .bind(code, id)
    .first();
  if (existing && existing.token_hash !== tokenHash) return fail(403, 'That member belongs to someone else.');
  if (!existing) {
    const { count } = await env.DB
      .prepare('SELECT COUNT(*) AS count FROM members WHERE group_code = ?')
      .bind(code)
      .first();
    if (count >= MAX_MEMBERS) return fail(409, 'This group is full.');
  }

  await env.DB
    .prepare(`INSERT INTO members (group_code, id, token_hash, name, weeks, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (group_code, id) DO UPDATE
              SET name = excluded.name, weeks = excluded.weeks, updated_at = excluded.updated_at`)
    .bind(code, id, tokenHash, name, JSON.stringify(weeks), new Date().toISOString())
    .run();
  return json({ ok: true });
}

/** Starts, keeps alive, or stops a member's running timer. */
async function putLive(request, env, code, id) {
  const tokenHash = await hashToken(request);
  if (!tokenHash) return fail(401, 'Missing token.');
  const member = await env.DB
    .prepare('SELECT token_hash FROM members WHERE group_code = ? AND id = ?')
    .bind(code, id)
    .first();
  if (!member) return fail(404, 'Not in that group.');
  if (member.token_hash !== tokenHash) return fail(403, 'That member belongs to someone else.');

  const body = await request.json().catch(() => null);
  const live = body?.live;
  if (live == null) {
    await env.DB.prepare('UPDATE members SET live = NULL, live_since = NULL, live_seen = NULL WHERE group_code = ? AND id = ?')
      .bind(code, id).run();
    return json({ ok: true });
  }
  const seconds = live.seconds;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 7 * 24 * 3600 || !Number.isInteger(live.colorSlot)) {
    throw new BadRequest('Bad timer.');
  }
  const now = Date.now();
  const name = live.name == null ? null : cleanName(live.name, MAX_SLICE_NAME);
  await env.DB
    .prepare('UPDATE members SET live = ?, live_since = ?, live_seen = ? WHERE group_code = ? AND id = ?')
    .bind(JSON.stringify({ name, colorSlot: live.colorSlot }), new Date(now - seconds * 1000).toISOString(),
      new Date(now).toISOString(), code, id)
    .run();
  return json({ ok: true });
}

async function deleteMember(request, env, code, id) {
  const tokenHash = await hashToken(request);
  if (!tokenHash) return fail(401, 'Missing token.');
  await env.DB
    .prepare('DELETE FROM members WHERE group_code = ? AND id = ? AND token_hash = ?')
    .bind(code, id, tokenHash)
    .run();
  return json({ ok: true });
}

/**
 * Each app makes up its own id and secret token the first time it joins. Only a hash
 * of the token is kept, and only the app holding the token can change that member.
 */
async function hashToken(request) {
  const token = /^Bearer (.{16,200})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

class BadRequest extends Error {}

function cleanName(raw, max) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, max);
  return name || null;
}

const isMinutes = (n) => Number.isInteger(n) && n >= 0 && n <= 7 * 24 * 60;

/** Week keys are each person's own Monday, as a calendar date. */
function cleanWeeks(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_WEEKS) throw new BadRequest('Bad weeks.');
  return raw.map((w) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w?.week ?? '') || !isMinutes(w.total)) throw new BadRequest('Bad week.');
    if (!Array.isArray(w.slices) || w.slices.length > MAX_SLICES) throw new BadRequest('Bad slices.');
    return {
      week: w.week,
      total: w.total,
      // A null name is someone keeping their activities to themselves.
      slices: w.slices.map((s) => {
        if (!isMinutes(s?.minutes) || !Number.isInteger(s.colorSlot)) throw new BadRequest('Bad slice.');
        return { name: s.name == null ? null : cleanName(s.name, MAX_SLICE_NAME), minutes: s.minutes, colorSlot: s.colorSlot };
      }),
    };
  });
}
