// Port of Friends.swift. Comparing weeks with a group of friends.
//
// Nothing leaves the computer until you start or join a group. From then on, every
// change pushes a summary of your last twelve weeks — a total and the slices, with the
// activity names left out if you'd rather — and never the entries themselves.

import * as W from './model.js';

export const SERVER = 'https://timepie-friends.timepie.workers.dev';
const WEEKS_SHARED = 12;

/** "ABCDEF" reads as "ABC-DEF". */
export const displayCode = (code) => (code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);

class Problem extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export class Friends {
  /** { code, memberID, token, name, hideNames } once you're in a group. */
  settings = null;
  members = [];
  /** The last thing that went wrong, worded for the person reading it. */
  problem = null;
  working = false;
  /** What this app would send right now. Your own row is drawn from this. */
  mine = [];
  #persist;
  #listeners = new Set();
  #pushTimer = null;
  #pushPending = false;

  constructor(json, persist) {
    this.#persist = persist;
    try {
      this.settings = json ? JSON.parse(json) : null;
    } catch {
      this.settings = null;
    }
  }

  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #changed() {
    this.#listeners.forEach((fn) => fn());
  }

  get pageURL() {
    return this.settings ? `${SERVER}/g/${this.settings.code}` : null;
  }

  // MARK: Joining and leaving

  startGroup(name) {
    return this.#run(async () => {
      const { code } = await this.#request('POST', '/api/groups');
      await this.#enter(code, name);
    });
  }

  join(raw, name) {
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) {
      this.problem = 'A group code is six letters and numbers, like ABC-DEF.';
      this.#changed();
      return Promise.resolve();
    }
    return this.#run(async () => {
      // Fetched first, so a mistyped code fails here rather than on the first push.
      this.members = (await this.#request('GET', `/api/groups/${code}`)).members;
      await this.#enter(code, name);
    });
  }

  async #enter(code, name) {
    this.#save({ code, memberID: crypto.randomUUID().toUpperCase(), token: makeToken(), name: name.trim(), hideNames: false });
    await this.#push();
    await this.#fetch();
  }

  async leave() {
    const s = this.settings;
    if (!s) return;
    // Even if the server can't be reached, this app stops sharing.
    await this.#request('DELETE', `/api/groups/${s.code}/members/${s.memberID}`, null, s.token).catch(() => {});
    this.#save(null);
    this.members = [];
    this.problem = null;
    this.#changed();
  }

  rename(name) {
    const trimmed = name.trim();
    if (!this.settings || !trimmed || trimmed === this.settings.name) return;
    this.#save({ ...this.settings, name: trimmed });
    this.#schedulePush(0);
  }

  setHideNames(hide, store) {
    if (!this.settings || this.settings.hideNames === hide) return;
    this.#save({ ...this.settings, hideNames: hide });
    this.storeChanged(store, 0, true);
  }

  // MARK: Keeping in step

  /**
   * Called whenever the data changes. Pushes are gathered up for a moment, so a run of
   * quick clicks sends one request rather than a dozen.
   */
  storeChanged(store, delay = 2000, force = false) {
    const summaries = summariesOf(store, this.settings?.hideNames ?? false);
    // Reordering or folding a folder changes nothing anyone else can see.
    if (!force && JSON.stringify(summaries) === JSON.stringify(this.mine)) return;
    this.mine = summaries;
    this.#changed();
    this.#schedulePush(delay);
  }

  #schedulePush(delay) {
    if (!this.settings) return;
    this.#pushPending = true;
    clearTimeout(this.#pushTimer);
    this.#pushTimer = setTimeout(() => this.#run(() => this.#push()), delay);
  }

  /** Fetches everyone's weeks, first sending ours if an earlier push didn't get through. */
  refresh() {
    if (!this.settings) return Promise.resolve();
    return this.#run(async () => {
      if (this.#pushPending) await this.#push();
      await this.#fetch();
    });
  }

  async #push() {
    const s = this.settings;
    if (!s) return;
    this.#pushPending = true;
    await this.#request('PUT', `/api/groups/${s.code}/members/${s.memberID}`, { name: s.name, weeks: this.mine }, s.token);
    this.#pushPending = false;
  }

  async #fetch() {
    const s = this.settings;
    if (!s) return;
    try {
      this.members = (await this.#request('GET', `/api/groups/${s.code}`)).members;
    } catch (e) {
      if (e.status !== 404) throw e;
      // The group is gone from the server; nothing to stay in.
      this.#save(null);
      this.members = [];
      throw new Problem('That group no longer exists.');
    }
  }

  /**
   * Everyone in the group for one week, highest total first, each as
   * { id, name, isMe, week, total, place }. Your own row uses what's on this computer.
   */
  standings(weekDate) {
    const key = W.DayStamp.string(W.weekStart(weekDate));
    const me = this.settings?.memberID;
    const rows = this.members.filter((m) => m.id !== me)
      .map((m) => ({ id: m.id, name: m.name, isMe: false, week: m.weeks.find((w) => w.week === key) ?? null }));
    if (this.settings) {
      rows.push({ id: me, name: this.settings.name, isMe: true, week: this.mine.find((w) => w.week === key) ?? null });
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

  #save(settings) {
    this.settings = settings;
    this.#persist(settings ? JSON.stringify(settings, null, 2) : null);
    this.#changed();
  }

  /** Runs one piece of network work, turning whatever goes wrong into `problem`. */
  async #run(work) {
    this.working = true;
    this.#changed();
    try {
      await work();
      this.problem = null;
    } catch (e) {
      this.problem = e instanceof Problem ? e.message : 'Can’t reach the TimePie server. Check your internet connection.';
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

export function summariesOf(store, hidingNames) {
  const thisWeek = W.weekStart(new Date());
  const out = [];
  for (let back = 0; back < WEEKS_SHARED; back++) {
    const start = W.addWeeks(-back, thisWeek);
    const end = W.weekEnd(start);
    const total = store.totalMinutes(start, end);
    if (total <= 0) continue;
    const slices = store.activitiesForWeek(start)
      .map((a) => ({ name: hidingNames ? null : a.name, minutes: store.minutes(a.id, start, end), colorSlot: a.colorSlot }))
      .filter((s) => s.minutes > 0);
    out.push({ week: W.DayStamp.string(start), total, slices });
  }
  return out;
}
