// Port of Friends.swift. Comparing weeks with groups of friends.
//
// Nothing leaves the computer until you start or join a group. From then on, every
// change pushes a summary of your last twelve weeks to each group you're in — a total
// and the slices, with the activity names left out if you'd rather — and never the
// entries themselves.

import * as W from './model.js';

export const SERVER = 'https://timepie-friends.timepie.workers.dev';
const WEEKS_SHARED = 12;
/**
 * How often a running timer tells the groups it's still going. The server forgets one it
 * hasn't heard from in a while, so a timer that dies with its app doesn't linger.
 */
const LIVE_HEARTBEAT = 60000;

/** "ABCDEF" reads as "ABC-DEF". */
export const displayCode = (code) => (code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);

/** The group's name, shared by everyone in it, or else its code. */
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
  /** The timer running here as { name, colorSlot, startedAt }, shown on your own row and sent to each group. */
  myTimer = null;
  #membersByGroup = new Map();
  #persist;
  #listeners = new Set();
  #pushTimer = null;
  /** Groups still owed the latest summary. */
  #pushPending = new Set();
  /** Groups you renamed that the server hasn't heard about yet. */
  #namePending = new Set();
  #liveTimer = null;
  /** The last timer update sent, so one in flight can't land after a stop. */
  #liveSending = Promise.resolve();

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
    if (this.myTimer) await this.#sendLive([code]);
    await this.#fetch(code);
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

  /** Names the group for everyone in it. An empty name goes back to showing the code. */
  setLabel(code, label) {
    const g = this.groups.find((g) => g.code === code);
    const trimmed = label.trim();
    if (!g || trimmed === (g.label ?? '')) return;
    this.#setCachedLabel(code, trimmed || null);
    this.#namePending.add(code);
    this.#run(() => this.#sendPendingNames());
  }

  /**
   * `labelShared` says the name has been to the server. Not so for one named in 1.4.0,
   * when names stayed on this computer.
   */
  #setCachedLabel(code, label, labelShared) {
    this.groups = this.groups.map((g) => (g.code === code
      ? { ...g, label: label ?? undefined, labelShared: labelShared ?? g.labelShared } : g));
    this.#save();
  }

  setHideNames(code, hide) {
    this.#update(code, { hideNames: hide });
    if (this.myTimer) this.#sendLive([code]);
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
    this.#namePending.delete(code);
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
   * Starts or stops showing your running timer to every group. While it runs it's re-sent
   * every so often; stopping it is sent at once. Nothing here goes through `problem`: a
   * missed beat is made up by the next one.
   */
  setTimer(timer) {
    const same = (a, b) => a?.name === b?.name && a?.colorSlot === b?.colorSlot && a?.startedAt === b?.startedAt;
    if (same(timer, this.myTimer)) return;
    this.myTimer = timer;
    this.#changed();
    clearInterval(this.#liveTimer);
    this.#liveTimer = null;
    const beat = () => this.#sendLive(this.groups.map((g) => g.code));
    beat();
    if (timer) this.#liveTimer = setInterval(beat, LIVE_HEARTBEAT);
  }

  #sendLive(codes) {
    // One after another, so a beat still in flight can't land after a stop.
    this.#liveSending = this.#liveSending.then(async () => {
      for (const code of codes) {
        const g = this.groups.find((g) => g.code === code);
        if (!g) continue;
        const t = this.myTimer;
        const live = t && {
          name: g.hideNames ? null : t.name, colorSlot: t.colorSlot,
          seconds: Math.max(0, Math.floor((Date.now() - t.startedAt) / 1000)),
        };
        await this.#request('PUT', `/api/groups/${code}/members/${g.memberID}/live`, { live: live ?? null }, g.token)
          .catch(() => {});
      }
    });
    return this.#liveSending;
  }

  /**
   * Fetches every group's weeks and name, the one on screen first, and sends anything an
   * earlier attempt didn't get through.
   */
  refresh() {
    const current = this.current;
    if (!current) return Promise.resolve(false);
    return this.#run(async () => {
      // One unreachable group shouldn't keep the others stale.
      let firstProblem = null;
      const attempt = (work) => work().catch((e) => { firstProblem ??= e; });
      await attempt(() => this.#pushPendingGroups());
      const others = this.groups.map((g) => g.code).filter((c) => c !== current.code);
      for (const code of [current.code, ...others]) await attempt(() => this.#fetch(code));
      // After fetching, so a name from 1.4.0 found just now goes up straight away.
      await attempt(() => this.#sendPendingNames());
      if (firstProblem) throw firstProblem;
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

  async #sendPendingNames() {
    let firstProblem = null;
    for (const code of [...this.#namePending].sort()) {
      const g = this.groups.find((g) => g.code === code);
      if (!g) {
        this.#namePending.delete(code);
        continue;
      }
      try {
        await this.#request('PUT', `/api/groups/${code}`, { name: g.label ?? '' }, g.token);
        this.#namePending.delete(code);
        const now = this.groups.find((g) => g.code === code);
        if (now) this.#setCachedLabel(code, now.label, true);
      } catch (e) {
        firstProblem ??= e;
      }
    }
    if (firstProblem) throw firstProblem;
  }

  async #fetch(code) {
    const g = this.groups.find((g) => g.code === code);
    if (!g) return;
    try {
      const response = await this.#request('GET', `/api/groups/${code}`);
      // Running timers count up from when they started on this computer's clock, so the
      // clocks never have to agree.
      const now = Date.now();
      this.#membersByGroup.set(code, response.members.map((m) => (m.live
        ? { ...m, live: { ...m.live, startedAt: now - m.live.seconds * 1000 } } : m)));
      // A rename still on its way here wins over the name it's replacing.
      if (this.#namePending.has(code)) return;
      const now = this.groups.find((g) => g.code === code);
      const label = now?.label ?? null;
      if (response.name == null && label != null && !now.labelShared) {
        // Named back when names stayed on this computer: share it now.
        this.#namePending.add(code);
      } else if (label !== (response.name ?? null) || !now.labelShared) {
        this.#setCachedLabel(code, response.name ?? null, true);
      }
    } catch (e) {
      if (e.status !== 404) throw e;
      // The group is gone from the server; nothing to stay in.
      this.#forget(g.code);
      throw new Problem(`${groupTitle(g)} no longer exists.`);
    }
  }

  /**
   * Everyone in the group on screen for one week, highest total first, each as
   * { id, name, isMe, week, live, total, place }. Your own row uses what's on this computer.
   */
  standings(weekDate) {
    const key = W.DayStamp.string(W.weekStart(weekDate));
    const g = this.current;
    const rows = this.members.filter((m) => m.id !== g?.memberID)
      .map((m) => ({
        id: m.id, name: m.name, isMe: false, week: m.weeks.find((w) => w.week === key) ?? null, live: m.live ?? null,
      }));
    if (g) {
      const weeks = g.hideNames ? hidingNames(this.mine) : this.mine;
      const t = this.myTimer;
      const live = t && { name: g.hideNames ? null : t.name, colorSlot: t.colorSlot, startedAt: t.startedAt };
      rows.push({ id: g.memberID, name: g.name, isMe: true, week: weeks.find((w) => w.week === key) ?? null, live });
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
