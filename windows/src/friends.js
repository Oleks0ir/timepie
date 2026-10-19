// Port of Friends.swift. Comparing weeks with groups of friends.
//
// Nothing leaves the computer until you start or join a group. From then on, every
// change pushes a summary of your last twelve weeks to each group you're in — a total
// and the slices, with the activity names left out if you'd rather — and never the
// entries themselves.

import * as W from './model.js';

export const SERVER = 'https://timepie-friends.timepie.workers.dev';
const WEEKS_SHARED = 12;

/** "ABCDEF" reads as "ABC-DEF". */
export const displayCode = (code) => (code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);

/** What you call a group (only this app sees it), or else its code. */
export const groupTitle = (group) => group.label?.trim() || displayCode(group.code);

/** The same weeks for a group you keep your activity names from. */
const hidingNames = (weeks) =>
  weeks.map((w) => ({ ...w, slices: w.slices.map((s) => ({ ...s, name: null })) }));

class Problem extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export class Friends {
  /** Each group you're in, as { code, memberID, token, name, hideNames, label }. */
  groups = [];
  /** The group on screen. */
  selectedCode = null;
  /** The last thing that went wrong, worded for the person reading it. */
  problem = null;
  working = false;
  /** What this app would send right now, names and all. Your own row is drawn from this. */
  mine = [];
  #membersByGroup = new Map();
  #persist;
  #listeners = new Set();
  #pushTimer = null;
  /** Groups still owed the latest summary. */
  #pushPending = new Set();

  constructor(json, persist) {
    this.#persist = persist;
    try {
      const saved = json ? JSON.parse(json) : null;
      // Before there could be several groups the file held one group alone.
      if (Array.isArray(saved?.groups)) {
        this.groups = saved.groups;
        this.selectedCode = saved.selected ?? null;
      } else if (saved?.code) {
        this.groups = [saved];
      }
    } catch {
      this.groups = [];
    }
    if (!this.current) this.selectedCode = this.groups[0]?.code ?? null;
  }

  get current() {
    return this.groups.find((g) => g.code === this.selectedCode) ?? null;
  }

  /** Everyone in the group on screen, as the server last said. */
  get members() {
    return this.#membersByGroup.get(this.selectedCode) ?? [];
  }

  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #changed() {
    this.#listeners.forEach((fn) => fn());
  }

  get pageURL() {
    return this.current ? `${SERVER}/g/${this.current.code}` : null;
  }

  select(code) {
    if (code === this.selectedCode || !this.groups.some((g) => g.code === code)) return;
    this.selectedCode = code;
    this.problem = null;
    this.#save();
    this.refresh();
  }

  // MARK: Joining and leaving

  /** Resolves true once you're in the new group. */
  startGroup(name) {
    return this.#run(async () => {
      const { code } = await this.#request('POST', '/api/groups');
      await this.#enter(code, name);
    });
  }

  /** Resolves true once you're in the group, including when you already were. */
  join(raw, name) {
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) {
      this.problem = 'A group code is six letters and numbers, like ABC-DEF.';
      this.#changed();
      return Promise.resolve(false);
    }
    if (this.groups.some((g) => g.code === code)) {
      this.select(code);
      return Promise.resolve(true);
    }
    return this.#run(async () => {
      // Fetched first, so a mistyped code fails here rather than on the first push.
      this.#membersByGroup.set(code, (await this.#request('GET', `/api/groups/${code}`)).members);
      await this.#enter(code, name);
    });
  }

  async #enter(code, name) {
    this.groups = [...this.groups,
      { code, memberID: crypto.randomUUID().toUpperCase(), token: makeToken(), name: name.trim(), hideNames: false }];
    this.selectedCode = code;
    this.#save();
    await this.#push(code);
    await this.#fetch();
  }

  /** Leaves the group on screen; the next one takes its place. */
  async leave() {
    const g = this.current;
    if (!g) return;
    // Even if the server can't be reached, this app stops sharing.
    await this.#request('DELETE', `/api/groups/${g.code}/members/${g.memberID}`, null, g.token).catch(() => {});
    this.#forget(g.code);
    this.problem = null;
    this.#changed();
  }

  rename(code, name) {
    const trimmed = name.trim();
    if (trimmed) this.#update(code, { name: trimmed });
  }

  setLabel(code, label) {
    const g = this.groups.find((g) => g.code === code);
    const trimmed = label.trim();
    if (!g || trimmed === (g.label ?? '')) return;
    this.groups = this.groups.map((g) => (g.code === code ? { ...g, label: trimmed || undefined } : g));
    this.#save();
  }

  setHideNames(code, hide) {
    this.#update(code, { hideNames: hide });
  }

  /** Changes what a group sees of you, and tells it. */
  #update(code, change) {
    const g = this.groups.find((g) => g.code === code);
    if (!g || Object.entries(change).every(([k, v]) => g[k] === v)) return;
    this.groups = this.groups.map((g) => (g.code === code ? { ...g, ...change } : g));
    this.#save();
    this.#schedulePush([code], 0);
  }

  /** Drops a group from this app, whether you left it or it's gone from the server. */
  #forget(code) {
    this.groups = this.groups.filter((g) => g.code !== code);
    this.#membersByGroup.delete(code);
    this.#pushPending.delete(code);
    if (this.selectedCode === code) this.selectedCode = this.groups[0]?.code ?? null;
    this.#save();
  }

  // MARK: Keeping in step

  /**
   * Called whenever the data changes. Pushes are gathered up for a moment, so a run of
   * quick clicks sends one request rather than a dozen.
   */
  storeChanged(store, delay = 2000, force = false) {
    const summaries = summariesOf(store);
    // Reordering or folding a folder changes nothing anyone else can see.
    if (!force && JSON.stringify(summaries) === JSON.stringify(this.mine)) return;
    this.mine = summaries;
    this.#changed();
    this.#schedulePush(this.groups.map((g) => g.code), delay);
  }

  #schedulePush(codes, delay) {
    codes.forEach((c) => this.#pushPending.add(c));
    if (this.#pushPending.size === 0) return;
    clearTimeout(this.#pushTimer);
    this.#pushTimer = setTimeout(() => this.#run(() => this.#pushPendingGroups()), delay);
  }

  /**
   * Fetches everyone's weeks in the group on screen, first sending ours to any group an
   * earlier push didn't get through to.
   */
  refresh() {
    if (!this.current) return Promise.resolve(false);
    return this.#run(async () => {
      // One unreachable group shouldn't keep this one's leaderboard stale.
      const pushProblem = await this.#pushPendingGroups().then(() => null, (e) => e);
      await this.#fetch();
      if (pushProblem) throw pushProblem;
    });
  }

  /** Tries every group still owed a push, then reports the first thing that failed. */
  async #pushPendingGroups() {
    let firstProblem = null;
    for (const code of [...this.#pushPending].sort()) {
      await this.#push(code).catch((e) => { firstProblem ??= e; });
    }
    if (firstProblem) throw firstProblem;
  }

  async #push(code) {
    const g = this.groups.find((g) => g.code === code);
    if (!g) {
      this.#pushPending.delete(code);
      return;
    }
    this.#pushPending.add(code);
    const weeks = g.hideNames ? hidingNames(this.mine) : this.mine;
    try {
      await this.#request('PUT', `/api/groups/${code}/members/${g.memberID}`, { name: g.name, weeks }, g.token);
    } catch (e) {
      if (e.status !== 404) throw e;
      this.#forget(code);
      throw new Problem(`${groupTitle(g)} no longer exists.`);
    }
    this.#pushPending.delete(code);
  }

  async #fetch() {
    const g = this.current;
    if (!g) return;
    try {
      this.#membersByGroup.set(g.code, (await this.#request('GET', `/api/groups/${g.code}`)).members);
    } catch (e) {
      if (e.status !== 404) throw e;
      // The group is gone from the server; nothing to stay in.
      this.#forget(g.code);
      throw new Problem(`${groupTitle(g)} no longer exists.`);
    }
  }

  /**
   * Everyone in the group on screen for one week, highest total first, each as
   * { id, name, isMe, week, total, place }. Your own row uses what's on this computer.
   */
  standings(weekDate) {
    const key = W.DayStamp.string(W.weekStart(weekDate));
    const g = this.current;
    const rows = this.members.filter((m) => m.id !== g?.memberID)
      .map((m) => ({ id: m.id, name: m.name, isMe: false, week: m.weeks.find((w) => w.week === key) ?? null }));
    if (g) {
      const weeks = g.hideNames ? hidingNames(this.mine) : this.mine;
      rows.push({ id: g.memberID, name: g.name, isMe: true, week: weeks.find((w) => w.week === key) ?? null });
    }
    rows.forEach((r) => { r.total = r.week?.total ?? 0; });
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    // Equal totals share a place; nobody places with nothing logged.
    let place = 0;
    rows.forEach((r, i) => {
      if (i === 0 || r.total !== rows[i - 1].total) place = i + 1;
      r.place = r.total > 0 ? place : null;
    });
    return rows;
  }

  // MARK: Plumbing

  #save() {
    this.#persist(this.groups.length
      ? JSON.stringify({ groups: this.groups, selected: this.selectedCode }, null, 2)
      : null);
    this.#changed();
  }

  /**
   * Runs one piece of network work, turning whatever goes wrong into `problem`.
   * Resolves true when it all went through.
   */
  async #run(work) {
    this.working = true;
    this.#changed();
    try {
      await work();
      this.problem = null;
      return true;
    } catch (e) {
      this.problem = e instanceof Problem ? e.message : 'Can’t reach the TimePie server. Check your internet connection.';
      return false;
    } finally {
      this.working = false;
      this.#changed();
    }
  }

  async #request(method, path, body = null, token = null) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(SERVER + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Problem(data.error ?? `The server said no (${res.status}).`, res.status);
    return data;
  }
}

function makeToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function summariesOf(store) {
  const thisWeek = W.weekStart(new Date());
  const out = [];
  for (let back = 0; back < WEEKS_SHARED; back++) {
    const start = W.addWeeks(-back, thisWeek);
    const end = W.weekEnd(start);
    const total = store.totalMinutes(start, end);
    if (total <= 0) continue;
    const slices = store.activitiesForWeek(start)
      .map((a) => ({ name: a.name, minutes: store.minutes(a.id, start, end), colorSlot: a.colorSlot }))
      .filter((s) => s.minutes > 0);
    out.push({ week: W.DayStamp.string(start), total, slices });
  }
  return out;
}
