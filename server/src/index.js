// The friends server: groups of people comparing their weekly donuts.
//
// It only ever holds what each app chose to send — a display name and a few recent
// weeks of totals — never the entries themselves. Every push replaces a member's
// weeks whole, so the server is a mirror of the apps, not a second source of truth.
//
//   POST   /api/groups                       → { code }
//   GET    /api/groups/:code                 → { code, members: [...] }
//   PUT    /api/groups/:code/members/:id     (Bearer token) ← { name, weeks }
//   DELETE /api/groups/:code/members/:id     (Bearer token)
//   GET    /g/:code                          → the leaderboard as a web page

// Wrangler bundles .html files as plain text.
import page from './page.html';

/** No 0/O or 1/I/L, so a code read aloud or off a screen can't be mistyped. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_MEMBERS = 50;
const MAX_WEEKS = 12;
const MAX_SLICES = 60;
const MAX_NAME = 40;
const MAX_SLICE_NAME = 60;

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
  if (path[0] !== 'api' || path[1] !== 'groups') return fail(404, 'Not found.');

  if (path.length === 2 && method === 'POST') return createGroup(env);

  const code = normaliseCode(path[2]);
  if (!code) return fail(404, 'No group has that code.');

  if (path.length === 3 && method === 'GET') return getGroup(env, code);
  if (path.length === 5 && path[3] === 'members') {
    const id = path[4];
    if (!/^[0-9A-Fa-f-]{36}$/.test(id)) return fail(400, 'Bad member id.');
    if (method === 'PUT') return putMember(request, env, code, id.toUpperCase());
    if (method === 'DELETE') return deleteMember(request, env, code, id.toUpperCase());
  }
  return fail(404, 'Not found.');
}

/** "abc-def", "ABC DEF" and "abcdef" all name the same group. */
function normaliseCode(raw) {
  const code = decodeURIComponent(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

async function createGroup(env) {
  // A collision is about one in a billion, but retrying costs nothing.
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    const code = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
    const { meta } = await env.DB
      .prepare('INSERT OR IGNORE INTO groups (code, created_at) VALUES (?, ?)')
      .bind(code, new Date().toISOString())
      .run();
    if (meta.changes === 1) return json({ code }, 201);
  }
  return fail(500, 'Could not make a group code. Try again.');
}

async function getGroup(env, code) {
  const group = await env.DB.prepare('SELECT code FROM groups WHERE code = ?').bind(code).first();
  if (!group) return fail(404, 'No group has that code.');
  const { results } = await env.DB
    .prepare('SELECT id, name, weeks, updated_at FROM members WHERE group_code = ?')
    .bind(code)
    .all();
  return json({
    code,
    members: results.map((m) => ({ id: m.id, name: m.name, weeks: JSON.parse(m.weeks), updatedAt: m.updated_at })),
  });
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
