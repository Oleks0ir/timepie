// Port of Models.swift, WeekMath.swift and Store.swift. The JSON on disk is the
// same format the Mac app writes, so files can move between the two.

// MARK: - Weeks (start on Monday, local time)

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(n, d) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export const addWeeks = (n, d) => addDays(7 * n, d);

export function weekStart(d) {
  const x = startOfDay(d);
  return addDays(-((x.getDay() + 6) % 7), x);
}

export const weekEnd = (d) => addDays(7, weekStart(d));
export const isSameWeek = (a, b) => weekStart(a).getTime() === weekStart(b).getTime();

const monthShort = (d) => d.toLocaleDateString(undefined, { month: 'short' });

/** "Sep 15 – 21" / "Sep 29 – Oct 5" */
export function weekLabel(d) {
  const start = weekStart(d);
  const end = addDays(6, start);
  return start.getMonth() === end.getMonth()
    ? `${monthShort(start)} ${start.getDate()} – ${end.getDate()}`
    : `${monthShort(start)} ${start.getDate()} – ${monthShort(end)} ${end.getDate()}`;
}

// MARK: - Calendar dates on disk ("2026-09-16"), never timestamps — they can't drift.

export const DayStamp = {
  string(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  parse(raw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw ?? '');
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    // Legacy timestamps: the stored instant was local midnight.
    const t = Date.parse(raw);
    return startOfDay(Number.isNaN(t) ? new Date() : new Date(t));
  },
};

/** ISO-8601 without fractional seconds — what Swift's `.iso8601` strategy reads. */
const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const newID = () => crypto.randomUUID().toUpperCase();

// MARK: - Durations read as "8h 30m"

export const Duration = {
  format(minutes) {
    const m = Math.max(0, minutes);
    const h = Math.floor(m / 60);
    const mins = m % 60;
    if (h === 0) return `${mins}m`;
    if (mins === 0) return `${h}h`;
    return `${h}h ${mins}m`;
  },

  /** A running stopwatch: "12:34", or "1:02:15" once it passes an hour. */
  clock(seconds) {
    const s = Math.max(0, seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  },

  /** Accepts "1h45", "1h 45m", "90", "90m", "1.5h", "2h". */
  parse(raw) {
    const toInt = (s) => (/^[+-]?\d+$/.test(s) ? parseInt(s, 10) : null);
    const toDouble = (s) => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : null);

    const s = raw.toLowerCase().trim();
    if (!s) return null;

    const hIndex = s.indexOf('h');
    if (hIndex >= 0) {
      const hours = toDouble(s.slice(0, hIndex).trim());
      const rest = s.slice(hIndex + 1).replaceAll('m', '').trim();
      if (hours === null) return null;
      const extra = rest ? (toInt(rest) ?? 0) : 0;
      return Math.round(hours * 60) + extra;
    }

    const cleaned = s.replaceAll('m', '').trim();
    const mins = toInt(cleaned);
    if (mins !== null) return mins;
    const dec = toDouble(cleaned);
    return dec === null ? null : Math.round(dec * 60);
  },
};

// MARK: - Palette slots

export const SLOT_COUNT = 8;

/** Lowest slot not already taken, else overflow grey. */
export function nextSlot(taken) {
  for (let slot = 0; slot < SLOT_COUNT; slot++) if (!taken.includes(slot)) return slot;
  return SLOT_COUNT;
}

// MARK: - Store

/**
 * Everything lives in one human-readable JSON file, held in memory and rewritten on
 * every change. Entries keep `day` as its "yyyy-MM-dd" string; those compare correctly
 * as plain strings, so a week is just a string range.
 */
export class Store {
  activities = [];
  entries = [];
  #undoStack = [];
  #undoLimit = 50;
  #listeners = new Set();
  #persist;

  constructor(json, persist) {
    this.#persist = persist;
    if (!json) return;
    try {
      const payload = JSON.parse(json);
      this.activities = payload.activities ?? [];
      this.entries = (payload.entries ?? []).map((e) => ({ ...e, day: DayStamp.string(DayStamp.parse(e.day)) }));
    } catch {
      return;
    }
    // "Delete" used to mean "archive"; anything still archived is purged.
    const archived = new Set(this.activities.filter((a) => a.archived).map((a) => a.id));
    if (archived.size) {
      this.activities = this.activities.filter((a) => !archived.has(a.id));
      this.entries = this.entries.filter((e) => !archived.has(e.activityID));
      this.#save();
    }
  }

  subscribe(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  get canUndo() {
    return this.#undoStack.length > 0;
  }

  get payload() {
    return { activities: this.activities, entries: this.entries, version: 1 };
  }

  #save() {
    this.#persist(JSON.stringify(sortKeys(this.payload), null, 2));
    this.#listeners.forEach((fn) => fn());
  }

  /** Snapshot, mutate, persist — the single path every edit takes. */
  #mutate(block) {
    this.#undoStack.push(structuredClone({ activities: this.activities, entries: this.entries }));
    if (this.#undoStack.length > this.#undoLimit) this.#undoStack.shift();
    block();
    this.#save();
  }

  undo() {
    const previous = this.#undoStack.pop();
    if (!previous) return;
    this.activities = previous.activities;
    this.entries = previous.entries;
    this.#save();
  }

  // MARK: Reading

  get visibleActivities() {
    return this.activities.filter((a) => !a.archived).sort((a, b) => a.sortIndex - b.sortIndex);
  }

  /** Everything started on or before this week, plus anything with time logged in it. */
  activitiesForWeek(start) {
    const logged = new Set(this.entriesIn(start, weekEnd(start)).map((e) => e.activityID));
    const startMs = start.getTime();
    return this.visibleActivities.filter((a) => {
      if (a.endWeek && weekStart(DayStamp.parse(a.endWeek)).getTime() <= startMs) return false;
      return this.#firstWeekStart(a).getTime() <= startMs || logged.has(a.id);
    });
  }

  entriesIn(start, end) {
    const lo = DayStamp.string(start);
    const hi = DayStamp.string(end);
    return this.entries.filter((e) => e.day >= lo && e.day < hi);
  }

  minutes(activityID, start, end) {
    return this.entriesIn(start, end)
      .filter((e) => e.activityID === activityID)
      .reduce((sum, e) => sum + e.minutes, 0);
  }

  /** Only activities that still exist, so the header can't disagree with the donut. */
  totalMinutes(start, end) {
    const known = new Set(this.activities.map((a) => a.id));
    const sum = this.entriesIn(start, end)
      .filter((e) => known.has(e.activityID))
      .reduce((s, e) => s + e.minutes, 0);
    return Math.max(0, sum);
  }

  // MARK: Writing

  #entry(activityID, day, minutes, isAdjustment) {
    return { id: newID(), activityID, day: DayStamp.string(day), minutes, isAdjustment, createdAt: isoNow() };
  }

  add(minutes, activityID, day) {
    this.#mutate(() => this.entries.push(this.#entry(activityID, day, minutes, false)));
  }

  /** The typed value is a week *total*; the difference is written as an adjustment. */
  setTotal(target, activityID, start, end, day) {
    const delta = target - this.minutes(activityID, start, end);
    if (delta === 0) return;
    this.#mutate(() => this.entries.push(this.#entry(activityID, day, delta, true)));
  }

  addActivity(name, inWeek) {
    this.#mutate(() => {
      const taken = this.activitiesForWeek(inWeek).map((a) => a.colorSlot);
      const nextIndex = Math.max(-1, ...this.activities.map((a) => a.sortIndex)) + 1;
      this.activities.push({
        id: newID(),
        name,
        colorSlot: nextSlot(taken),
        sortIndex: nextIndex,
        archived: false,
        createdAt: isoNow(),
        firstWeek: DayStamp.string(weekStart(inWeek)),
      });
    });
  }

  #update(id, fields) {
    const i = this.activities.findIndex((a) => a.id === id);
    if (i < 0) return;
    this.#mutate(() => {
      this.activities[i] = { ...this.activities[i], ...fields };
    });
  }

  setColor(id, slot) {
    this.#update(id, { colorSlot: slot });
  }

  rename(id, name) {
    this.#update(id, { name });
  }

  /**
   * Moves an activity to `to` in one week's list. There is a single order shared by
   * every week, so it is placed beside the same neighbour in the full list. Activities
   * this week doesn't show keep their places.
   */
  move(id, to, inWeek) {
    const week = this.activitiesForWeek(weekStart(inWeek));
    const from = week.findIndex((a) => a.id === id);
    if (from < 0) return;
    to = Math.min(Math.max(to, 0), week.length - 1);
    if (to === from) return;

    const [moved] = week.splice(from, 1);
    const all = this.visibleActivities.filter((a) => a.id !== id);
    const at = to < week.length
      ? all.findIndex((a) => a.id === week[to].id)
      : all.findIndex((a) => a.id === week[to - 1].id) + 1;
    all.splice(at, 0, moved);

    const order = new Map(all.map((a, i) => [a.id, i]));
    this.#mutate(() => {
      this.activities = this.activities.map((a) => (order.has(a.id) ? { ...a, sortIndex: order.get(a.id) } : a));
    });
  }

  #firstWeekStart(a) {
    return weekStart(a.firstWeek ? DayStamp.parse(a.firstWeek) : new Date(a.createdAt));
  }

  /**
   * Removes the activity from this week and every later one, with the time logged there.
   * Earlier weeks keep the row and their hours; if no earlier week ever showed it, it
   * goes entirely. Undo restores all of it.
   */
  delete(id, fromWeek) {
    const activity = this.activities.find((a) => a.id === id);
    if (!activity) return;
    const start = weekStart(fromWeek);
    const startDay = DayStamp.string(start);
    const shownEarlier = this.#firstWeekStart(activity).getTime() < start.getTime()
      || this.entries.some((e) => e.activityID === id && e.day < startDay);
    this.#mutate(() => {
      this.entries = this.entries.filter((e) => e.activityID !== id || e.day < startDay);
      this.activities = shownEarlier
        ? this.activities.map((a) => (a.id === id ? { ...a, endWeek: startDay } : a))
        : this.activities.filter((a) => a.id !== id);
    });
  }
}

/** Matches the Mac app's `.sortedKeys` output so diffs between the two stay clean. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}
