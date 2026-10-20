// Port of ContentView, ActivityRow, DonutChart and HistoryStrip.
import { html, render, useState, useEffect, useLayoutEffect, useRef } from './vendor/preact-htm.js';
import * as W from './model.js';
import { Friends, displayCode, groupTitle } from './friends.js';

const { Duration, SLOT_COUNT } = W;
const api = window.timepie;

const store = new W.Store(await api.load(), (json) => api.save(json));
const friends = new Friends(await api.loadFriends(), (json) => api.saveFriends(json));

// Every change goes out to the group, if you're in one.
friends.storeChanged(store, 0, true);
store.subscribe(() => friends.storeChanged(store));

// Ctrl+Z: text fields keep their own undo, everything else undoes the store.
api.onUndo(() => {
  if (isTyping()) document.execCommand('undo');
  else store.undo();
});

const isTyping = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
const slotColor = (slot) => `var(--c${slot >= 0 && slot < SLOT_COUNT ? slot : SLOT_COUNT})`;
/** Stops a double-click on a control from also toggling the row's timer. */
const stop = (e) => e.stopPropagation();

function useStore() {
  const [, bump] = useState(0);
  useEffect(() => store.subscribe(() => bump((n) => n + 1)), []);
  return store;
}

function useFriends() {
  const [, bump] = useState(0);
  useEffect(() => friends.subscribe(() => bump((n) => n + 1)), []);
  return friends;
}

// MARK: - Glyphs (stand-ins for the SF Symbols)

const Chevron = ({ dir, size = 12 }) => {
  const d = { left: 'M8 2 L4 6 L8 10', right: 'M4 2 L8 6 L4 10', down: 'M2 4 L6 8 L10 4' }[dir];
  return html`<svg width=${size} height=${size} viewBox="0 0 12 12" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d=${d} /></svg>`;
};
const PlayGlyph = () => html`<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1 L9 5 L2 9 Z" fill="currentColor" /></svg>`;
const StopGlyph = () => html`<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" rx="1.2" fill="currentColor" /></svg>`;
const FolderGlyph = () => html`<svg width="14" height="12" viewBox="0 0 14 12" fill="none" stroke="currentColor"
  stroke-width="1.1" stroke-linejoin="round"><path d="M1 2.5 Q1 1.5 2 1.5 H5 L6.5 3 H12 Q13 3 13 4 V9.5 Q13 10.5 12 10.5 H2 Q1 10.5 1 9.5 Z" /></svg>`;
const FolderPlusGlyph = () => html`<svg width="16" height="13" viewBox="0 0 16 13" fill="none" stroke="currentColor"
  stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">
  <path d="M13 5.5 V4 Q13 3 12 3 H6.5 L5 1.5 H2 Q1 1.5 1 2.5 V9.5 Q1 10.5 2 10.5 H8.5" /><path d="M12.5 7.5 V12 M10.25 9.75 H14.75" /></svg>`;
const PeopleGlyph = () => html`<svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="currentColor"
  stroke-width="1.2" stroke-linecap="round"><circle cx="6.5" cy="4" r="2.6" /><path d="M1.5 12.5 Q1.5 8 6.5 8 Q11.5 8 11.5 12.5" />
  <circle cx="12.5" cy="4.2" r="2.1" /><path d="M12.5 7.8 Q16.5 7.8 16.5 12" /></svg>`;
const PlusCircle = () => html`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2">
  <circle cx="7" cy="7" r="6" /><path d="M7 4 V10 M4 7 H10" stroke-linecap="round" /></svg>`;

// MARK: - App

function App() {
  const store = useStore();
  const [viewedWeek, setViewedWeek] = useState(() => W.weekStart(new Date()));
  // The day a click attributes to. Always inside the viewed week.
  const [loggingDay, setLoggingDay] = useState(() => W.startOfDay(new Date()));
  const [hoveredID, setHoveredID] = useState(null);
  // The group's leaderboard in place of your own chart and rows.
  const [showingFriends, setShowingFriends] = useState(false);
  // The row being dragged by its handle: { id, isFolder, from, offset, stride, slot, into }.
  // `slot` is where the gap is, as an index into the rows without the lifted one;
  // `into` is a folder the lifted task is held over, to drop it in.
  const [drag, setDrag] = useState(null);
  // A running timer is deliberately *not* persisted: it dies with the app. Nothing is
  // written until you stop it, so a crash loses the session rather than inventing one.
  const [running, setRunning] = useState(null);
  const [now, setNow] = useState(Date.now());

  const runningRef = useRef(running);
  runningRef.current = running;
  const weekRef = useRef(viewedWeek);
  weekRef.current = viewedWeek;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // The groups see a running timer, renamed or recoloured along with its activity.
  const runningActivity = running && store.activities.find((a) => a.id === running.activityID);
  useEffect(() => {
    friends.setTimer(runningActivity
      ? { name: runningActivity.name, colorSlot: runningActivity.colorSlot, startedAt: running.startedAt }
      : null);
  }, [runningActivity?.name, runningActivity?.colorSlot, running?.startedAt]);

  // The leaderboard keeps itself current while it's on screen, often enough to catch a
  // friend starting a timer.
  useEffect(() => {
    if (!showingFriends) return;
    friends.refresh();
    const t = setInterval(() => friends.refresh(), 30000);
    return () => clearInterval(t);
  }, [showingFriends]);

  const select = (week) => {
    const start = W.weekStart(week);
    setViewedWeek(start);
    setLoggingDay(W.isSameWeek(start, new Date()) ? W.startOfDay(new Date()) : start);
  };

  // ← and → step through weeks, unless a text field is taking the arrow keys.
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping() || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') select(W.addWeeks(-1, weekRef.current));
      if (e.key === 'ArrowRight') select(W.addWeeks(1, weekRef.current));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const weekEnd = W.weekEnd(viewedWeek);
  const outline = store.outlineForWeek(viewedWeek);
  // Every task in the week in list order, hidden ones included — the chart's slices.
  const activities = outline.flatMap((x) => (x.kind === 'folder' ? x.tasks : [x.activity]));
  const minutesFor = (a) => store.minutes(a.id, viewedWeek, weekEnd);
  const weekTotal = store.totalMinutes(viewedWeek, weekEnd);
  const takenSlots = new Set(activities.map((a) => a.colorSlot));
  const elapsed = running ? Math.max(0, Math.floor((now - running.startedAt) / 1000)) : 0;

  /**
   * The rows on screen, each with the folder it sits in as `parent`. A collapsed
   * folder's tasks are left out, and so are those of a folder being dragged.
   */
  const visibleRows = (hiding = drag?.id) => outline.flatMap((x) => {
    if (x.kind === 'activity') return [{ ...x, parent: null }];
    const hidden = x.folder.collapsed || x.id === hiding;
    return [{ ...x, parent: null },
      ...(hidden ? [] : x.tasks.map((a) => ({ kind: 'activity', id: a.id, activity: a, parent: x.id })))];
  });
  const rows = visibleRows();

  /**
   * Moves the gap to follow the lifted row, a place at a time once it covers more than
   * half of its neighbour. A task passing over a folder pauses there instead: held over
   * the middle of the folder's row, it would drop into the folder.
   */
  const settle = (d, others) => {
    const top = d.offset / d.stride + d.from; // the lifted row's top edge, in rows
    let slot = d.slot;
    let into = null;
    for (;;) {
      const down = top > slot;
      const overlap = Math.abs(top - slot);
      const n = down ? slot : slot - 1;
      if (n < 0 || n >= others.length) break;
      if (!d.isFolder && others[n].kind === 'folder') {
        if (overlap > 0.7) { slot += down ? 1 : -1; continue; }
        if (overlap >= 0.3) into = others[n].id;
        break;
      }
      if (overlap <= 0.5) break;
      slot += down ? 1 : -1;
    }
    return { ...d, slot, into };
  };

  const dragRow = (id, isFolder, index, dy, stride) => {
    setDrag((d) => {
      const lifted = d ?? { id, isFolder, from: index, slot: index, into: null };
      const others = visibleRows(id).filter((r) => r.id !== id);
      // Kept within the list, so the row can't be dragged off either end.
      const offset = Math.min(Math.max(dy, -lifted.from * stride), (others.length - lifted.from) * stride);
      return settle({ ...lifted, offset, stride }, others);
    });
  };

  /** How far a row is pushed to open the gap; the lifted row follows the cursor. */
  const displacement = (index) => {
    if (!drag) return 0;
    if (index === drag.from) return drag.offset;
    const k = index < drag.from ? index : index - 1;
    return ((k < drag.slot ? k : k + 1) - index) * drag.stride;
  };

  /** Where the lifted row would land: { parent (a folder, or null), index }. */
  const dropTarget = (d) => {
    if (d.into) return { parent: d.into, index: Infinity };
    const others = visibleRows(d.id).filter((r) => r.id !== d.id);
    const before = others.slice(0, d.slot);
    const topLevel = before.filter((r) => !r.parent).length;
    // Folders don't nest; one dropped among a folder's tasks lands after it.
    if (d.isFolder) return { parent: null, index: topLevel };
    // Between two of a folder's tasks, or above its first: in that folder.
    const below = others[d.slot];
    if (below?.parent) return { parent: below.parent, index: before.filter((r) => r.parent === below.parent).length };
    // Straight under an open folder that has nothing else in it.
    const above = before[before.length - 1];
    if (above?.kind === 'folder' && !above.folder.collapsed) return { parent: above.id, index: 0 };
    return { parent: null, index: topLevel };
  };

  const endDrag = () => {
    if (drag) {
      const target = dropTarget(drag);
      store.move(drag.id, target.parent, target.index, viewedWeek);
    }
    setDrag(null);
  };

  const stopTimer = () => {
    const timer = runningRef.current;
    if (!timer) return;
    setRunning(null);
    runningRef.current = null;
    const minutes = Math.round((Date.now() - timer.startedAt) / 60000);
    // Anything under half a minute rounds to nothing and isn't worth an entry.
    if (minutes > 0) store.add(minutes, timer.activityID, timer.day);
  };

  const toggleTimer = (activity) => {
    if (runningRef.current?.activityID === activity.id) return stopTimer();
    // One timer at a time: starting a new one logs and closes the old.
    stopTimer();
    const startedAt = Date.now();
    setNow(startedAt);
    // The day the timer *started* — a session running past midnight stays put.
    setRunning({ activityID: activity.id, startedAt, day: W.startOfDay(new Date(startedAt)) });
  };

  const slices = activities.map((a) => ({
    id: a.id, name: a.name, minutes: Math.max(0, minutesFor(a)), colorSlot: a.colorSlot,
  }));

  const thisWeek = W.weekStart(new Date());
  const thumbs = Array.from({ length: 12 }, (_, i) => {
    const start = W.addWeeks(i - 11, thisWeek);
    const end = W.weekEnd(start);
    return {
      id: start.getTime(),
      start,
      label: W.weekLabel(start),
      totalMinutes: store.totalMinutes(start, end),
      slices: store.activitiesForWeek(start)
        .map((a) => ({ id: a.id, name: a.name, minutes: store.minutes(a.id, start, end), colorSlot: a.colorSlot }))
        .filter((s) => s.minutes > 0),
    };
  });

  return html`
    <div class="app">
      <div class="header">
        <button class="chev" onClick=${() => select(W.addWeeks(-1, viewedWeek))} title="Previous week (←)">
          <${Chevron} dir="left" />
        </button>
        <div class="week-label">
          <span class="title">${W.weekLabel(viewedWeek)}</span>
          <span class="sep">·</span>
          <span class="total num">${Duration.format(weekTotal)}</span>
        </div>
        <button class="chev" onClick=${() => select(W.addWeeks(1, viewedWeek))} title="Next week (→)">
          <${Chevron} dir="right" />
        </button>
        <button class="friends-toggle ${showingFriends ? 'on' : ''}" onClick=${() => setShowingFriends((v) => !v)}
          title=${showingFriends ? 'Back to your week' : 'Compare this week with friends'}>
          <${PeopleGlyph} />
        </button>
      </div>

      ${showingFriends ? html`<${FriendsView} week=${viewedWeek} />` : html`
      <div class="chart">
        <${Donut} slices=${slices} size=${250} hoveredID=${hoveredID} onHover=${setHoveredID} animate />
      </div>

      <div class="rows ${drag ? 'reordering' : ''}">
        ${rows.map((r, index) => {
          if (r.kind === 'folder') {
            const f = r.folder;
            return html`
              <${FolderRow}
                key=${r.id}
                folder=${f}
                taskCount=${r.tasks.length}
                minutes=${r.tasks.reduce((sum, a) => sum + Math.max(0, minutesFor(a)), 0)}
                isHovered=${drag ? drag.id === r.id : hoveredID === r.id}
                isDragging=${drag?.id === r.id}
                isDropTarget=${drag?.into === r.id}
                offset=${displacement(index)}
                runningSeconds=${f.collapsed && r.tasks.some((a) => a.id === running?.activityID) ? elapsed : null}
                onHover=${(on) => setHoveredID(on ? r.id : null)}
                onToggle=${() => store.setCollapsed(r.id, !f.collapsed)}
                onRename=${(name) => store.renameFolder(r.id, name)}
                onDelete=${() => store.deleteFolder(r.id)}
                onDrag=${(dy, stride) => dragRow(r.id, true, index, dy, stride)}
                onDragEnd=${endDrag}
              />`;
          }
          const a = r.activity;
          return html`
          <${ActivityRow}
            key=${a.id}
            activity=${a}
            minutes=${minutesFor(a)}
            isHovered=${drag ? drag.id === a.id : hoveredID === a.id}
            isDragging=${drag?.id === a.id}
            inFolder=${drag?.id === a.id ? !!dropTarget(drag).parent : !!r.parent}
            offset=${displacement(index)}
            onDrag=${(dy, stride) => dragRow(a.id, false, index, dy, stride)}
            onDragEnd=${endDrag}
            isRunning=${running?.activityID === a.id}
            elapsedSeconds=${running?.activityID === a.id ? elapsed : 0}
            takenSlots=${takenSlots}
            onHover=${(on) => setHoveredID(on ? a.id : null)}
            onAdd=${(m) => store.add(m, a.id, loggingDay)}
            onSetTotal=${(m) => store.setTotal(m, a.id, viewedWeek, weekEnd, loggingDay)}
            onToggleTimer=${() => toggleTimer(a)}
            onSetColor=${(slot) => store.setColor(a.id, slot)}
            onRename=${(name) => store.rename(a.id, name)}
            onDelete=${() => {
              // Don't leave a timer running against something that's gone.
              if (runningRef.current?.activityID === a.id) setRunning(null);
              store.delete(a.id, viewedWeek);
            }}
          />`;
        })}
        <${AddActivityField} onAdd=${(name) => store.addActivity(name, viewedWeek)}
          onAddFolder=${(name) => store.addFolder(name, viewedWeek)} />
      </div>

      <${HistoryStrip} weeks=${thumbs} selected=${viewedWeek.getTime()} onSelect=${select} />`}
    </div>
  `;
}

// MARK: - Donut

/** Angles in radians, starting at 12 o'clock and running clockwise. */
function arcsFor(slices) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.minutes), 0);
  if (total === 0) return [];
  let cursor = -Math.PI / 2;
  return slices.filter((s) => s.minutes > 0).map((s) => {
    const sweep = (s.minutes / total) * 2 * Math.PI;
    const arc = { id: s.id, colorSlot: s.colorSlot, start: cursor, end: cursor + sweep };
    cursor += sweep;
    return arc;
  });
}

/** Split in two so even a full 360° slice draws (an SVG arc can't end where it starts). */
function arcPath(cx, cy, r, a0, a1) {
  const pt = (a) => `${(cx + r * Math.cos(a)).toFixed(3)} ${(cy + r * Math.sin(a)).toFixed(3)}`;
  const mid = (a0 + a1) / 2;
  return `M ${pt(a0)} A ${r} ${r} 0 0 1 ${pt(mid)} A ${r} ${r} 0 0 1 ${pt(a1)}`;
}

/** Wedges grow smoothly when time is added, rather than snapping to their new size. */
function useTweenedArcs(targets, animate) {
  const key = targets.map((t) => `${t.id}:${t.colorSlot}:${t.start.toFixed(5)}:${t.end.toFixed(5)}`).join('|');
  const [shown, setShown] = useState(targets);
  const shownRef = useRef(targets);

  useEffect(() => {
    if (!animate) return;
    const from = new Map(shownRef.current.map((a) => [a.id, a]));
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const p = Math.min(1, Math.max(0, (t - t0) / 350));
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const frame = targets.map((a) => {
        const f = from.get(a.id) ?? { start: a.start, end: a.start };
        return { ...a, start: f.start + (a.start - f.start) * e, end: f.end + (a.end - f.end) * e };
      });
      shownRef.current = frame;
      setShown(frame);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key]);

  return animate ? shown : targets;
}

/** Part-to-whole at a glance. 100% is the time you logged, not the whole week. */
function Donut({ slices, size, hoveredID, onHover, compact = false, animate = false }) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.minutes), 0);
  const ringWidth = size * (compact ? 0.30 : 0.28);
  const outerR = size / 2;
  const midR = outerR - ringWidth / 2;
  const innerR = outerR - ringWidth;
  const c = size / 2;

  const targets = arcsFor(slices);
  const arcs = useTweenedArcs(targets, animate);

  // Which wedge the pointer is over comes from its angle and radius, not from
  // whichever overlapping shape happens to be on top.
  const onMove = (e) => {
    if (compact || !onHover) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - c;
    const dy = e.clientY - rect.top - c;
    const r = Math.hypot(dx, dy);
    if (r < innerR || r > outerR) return onHover(null);
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;
    const hit = targets.find((a) => angle >= a.start + Math.PI / 2 && angle < a.end + Math.PI / 2);
    onHover(hit ? hit.id : null);
  };

  return html`
    <div class="donut" style=${{ width: size + 'px', height: size + 'px' }}>
      <svg width=${size} height=${size} viewBox="0 0 ${size} ${size}"
        onMouseMove=${onMove} onMouseLeave=${() => !compact && onHover?.(null)}>
        ${total === 0
          ? html`<circle cx=${c} cy=${c} r=${Math.max(0, (size - ringWidth) / 2 - 0.5)} fill="none"
              stroke="var(--muted)" stroke-opacity="0.35" stroke-width="1" />`
          : arcs.map((a) => html`
              <path key=${a.id} d=${arcPath(c, c, midR, a.start, a.end)} fill="none"
                stroke=${slotColor(a.colorSlot)}
                stroke-width=${hoveredID === a.id ? ringWidth + 6 : ringWidth}
                stroke-linecap="butt" />`)}
      </svg>
      ${!compact && html`<${CenterFigure} minutes=${total} width=${innerR * 2 - 16} />`}
    </div>
  `;
}

/** The one number the app leads with; shrinks (to half, at most) rather than clipping. */
function CenterFigure({ minutes, width }) {
  const ref = useRef();
  const text = Duration.format(minutes);
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.fontSize = '34px';
    const natural = el.offsetWidth;
    if (natural > width) el.style.fontSize = `${34 * Math.max(0.5, width / natural)}px`;
  }, [text, width]);
  return html`<div class="center-figure ${minutes === 0 ? 'empty' : ''}"><span ref=${ref}>${text}</span></div>`;
}

// MARK: - Activity row

/**
 * Three zones — name, total, controls. The outer two expand equally, so the fixed-width
 * total column lands dead centre and stays aligned across every row.
 */
function ActivityRow(props) {
  const { activity, minutes, isHovered, isRunning, elapsedSeconds, takenSlots, isDragging, offset, inFolder } = props;
  const [editingHours, setEditingHours] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [pickingColor, setPickingColor] = useState(false);

  const onContextMenu = async (e) => {
    e.preventDefault();
    const choice = await api.contextMenu([{ id: 'rename', label: 'Rename…' }, '-', { id: 'delete', label: 'Delete' }]);
    if (choice === 'rename') setEditingName(true);
    if (choice === 'delete') props.onDelete();
  };

  return html`
    <div class="row ${isHovered ? 'hovered' : ''} ${isDragging ? 'dragging' : ''} ${inFolder ? 'in-folder' : ''}"
      style=${offset ? { transform: `translateY(${offset}px)` } : null}
      onMouseEnter=${() => props.onHover(true)} onMouseLeave=${() => props.onHover(false)}
      onDblClick=${props.onToggleTimer} onContextMenu=${onContextMenu}
      title=${isRunning ? 'Double-click to stop' : 'Double-click to start a timer'}>

      <div class="zone-name">
        <button class="dot-btn" title="Change colour" onDblClick=${stop}
          onClick=${() => setPickingColor((v) => !v)}>
          <span class="dot" style=${{ background: slotColor(activity.colorSlot) }} />
        </button>
        ${pickingColor && html`
          <${ColorSwatchPicker} current=${activity.colorSlot} taken=${takenSlots}
            onClose=${() => setPickingColor(false)}
            onPick=${(slot) => { props.onSetColor(slot); setPickingColor(false); }} />`}

        ${editingName
          ? html`<${InlineField} initial=${activity.name}
              onCommit=${(v) => { const t = v.trim(); if (t) props.onRename(t); setEditingName(false); }}
              onCancel=${() => setEditingName(false)} />`
          : html`<span class="name">${activity.name}</span>`}

        <span class="spacer" />
        ${isRunning && html`<span class="stopwatch num">${Duration.clock(elapsedSeconds)}</span>`}
      </div>

      <div class="zone-total" onDblClick=${stop}>
        ${editingHours
          ? html`<${InlineField} initial=${minutes === 0 ? '' : Duration.format(minutes)}
              onCommit=${(v) => { const m = Duration.parse(v); if (m !== null) props.onSetTotal(m); setEditingHours(false); }}
              onCancel=${() => setEditingHours(false)} />`
          : html`<div class="total num ${minutes === 0 ? 'zero' : ''}"
              title="Click to type this week's total — 1h45, 90, 1.5h, 2h"
              onClick=${() => setEditingHours(true)}>${Duration.format(minutes)}</div>`}
      </div>

      <div class="zone-controls" onDblClick=${stop}>
        <button class="btn icon" onClick=${props.onToggleTimer}
          style=${isRunning ? { color: slotColor(activity.colorSlot) } : null}
          title=${isRunning ? 'Stop and log this session' : 'Start a timer'}>
          ${isRunning ? html`<${StopGlyph} />` : html`<${PlayGlyph} />`}
        </button>
        <button class="btn" onClick=${() => props.onAdd(30)}>+30m</button>
        <button class="btn" onClick=${() => props.onAdd(60)}>+1h</button>
        <${DragHandle} onDrag=${props.onDrag} onDragEnd=${props.onDragEnd} />
      </div>
    </div>
  `;
}

/**
 * A folder's header: click it to hide or show the tasks beneath it. It has no colour or
 * time of its own, so the total is its tasks' for the week and isn't editable.
 */
function FolderRow(props) {
  const { folder, taskCount, minutes, isHovered, isDragging, isDropTarget, offset, runningSeconds } = props;
  const [editingName, setEditingName] = useState(false);

  const onContextMenu = async (e) => {
    e.preventDefault();
    const choice = await api.contextMenu([
      { id: 'rename', label: 'Rename…' }, '-', { id: 'delete', label: 'Delete Folder (Keeps Its Tasks)' },
    ]);
    if (choice === 'rename') setEditingName(true);
    if (choice === 'delete') props.onDelete();
  };

  return html`
    <div class="row folder-row ${isHovered ? 'hovered' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}"
      style=${offset ? { transform: `translateY(${offset}px)` } : null}
      onMouseEnter=${() => props.onHover(true)} onMouseLeave=${() => props.onHover(false)}
      onClick=${() => !editingName && props.onToggle()} onContextMenu=${onContextMenu}
      title=${folder.collapsed ? 'Click to show its tasks' : 'Click to hide its tasks'}>

      <div class="zone-name">
        <span class="chevron ${folder.collapsed ? '' : 'open'}"><${Chevron} dir="right" size=${10} /></span>
        <${FolderGlyph} />
        ${editingName
          ? html`<${InlineField} initial=${folder.name}
              onCommit=${(v) => { const t = v.trim(); if (t) props.onRename(t); setEditingName(false); }}
              onCancel=${() => setEditingName(false)} />`
          : html`<span class="name folder-name">${folder.name}</span>`}
        ${folder.collapsed && taskCount > 0 && html`<span class="count">${taskCount}</span>`}
        <span class="spacer" />
        ${runningSeconds != null && html`<span class="stopwatch num">${Duration.clock(runningSeconds)}</span>`}
      </div>

      <div class="zone-total">
        <div class="total folder-total num ${minutes === 0 ? 'zero' : ''}">${Duration.format(minutes)}</div>
      </div>

      <div class="zone-controls" onClick=${stop}>
        <${DragHandle} onDrag=${props.onDrag} onDragEnd=${props.onDragEnd} />
      </div>
    </div>
  `;
}

/** Three dots stacked vertically. Press and hold to drag the row up or down. */
function DragHandle({ onDrag, onDragEnd }) {
  const start = useRef(null);
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Captured, so the drag keeps going even when the pointer outruns the row.
    e.currentTarget.setPointerCapture(e.pointerId);
    const row = e.currentTarget.closest('.row');
    start.current = { y: e.clientY, stride: row.getBoundingClientRect().height + 2 };
    onDrag(0, start.current.stride);
  };
  const onPointerMove = (e) => {
    if (start.current) onDrag(e.clientY - start.current.y, start.current.stride);
  };
  const finish = () => {
    if (!start.current) return;
    start.current = null;
    onDragEnd();
  };
  return html`<div class="grip" title="Drag to reorder"
    onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
    onPointerUp=${finish} onPointerCancel=${finish}>
    <span /><span /><span />
  </div>`;
}

/** A text field that commits on Enter or when you click away, and cancels on Esc. */
function InlineField({ initial, onCommit, onCancel }) {
  const ref = useRef();
  const done = useRef(false);
  useLayoutEffect(() => {
    ref.current.focus();
    ref.current.select();
  }, []);
  const finish = (fn) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  return html`<input ref=${ref} class="field" value=${initial} onDblClick=${stop}
    onKeyDown=${(e) => {
      if (e.key === 'Enter') finish(() => onCommit(e.currentTarget.value));
      if (e.key === 'Escape') finish(onCancel);
    }}
    onBlur=${(e) => finish(() => onCommit(e.currentTarget.value))} />`;
}

/** The eight validated palette slots plus the neutral overflow, as pickable swatches. */
function ColorSwatchPicker({ current, taken, onPick, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const away = (e) => !ref.current?.parentElement.contains(e.target) && onClose();
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  return html`
    <div class="popover" ref=${ref} onDblClick=${stop}>
      <div class="caption">Colour</div>
      <div class="swatches">
        ${Array.from({ length: SLOT_COUNT + 1 }, (_, slot) => html`
          <button class="swatch ${slot === current ? 'current' : ''}" onClick=${() => onPick(slot)}
            title=${slot === SLOT_COUNT ? 'Neutral grey (past the eight-colour palette)' : `Palette colour ${slot + 1}`}>
            <span class="fill" style=${{ background: slotColor(slot) }} />
            ${taken.has(slot) && slot !== current && html`<span class="taken" />`}
          </button>`)}
      </div>
      <div class="hint">A dot marks a colour another activity already uses.</div>
    </div>
  `;
}

/** The inline `+` below the rows — a field you type into, never a dialog. */
/** The inline `+` below the rows. The folder button at its right end names a new folder. */
function AddActivityField({ onAdd, onAddFolder }) {
  const [mode, setMode] = useState(null); // 'activity' | 'folder' | null
  const [draft, setDraft] = useState('');
  const ref = useRef();

  useEffect(() => {
    if (mode) ref.current?.focus();
  }, [mode]);

  const collapse = () => {
    setDraft('');
    setMode(null);
  };

  const commit = () => {
    const t = draft.trim();
    if (mode === 'folder') {
      if (t) onAddFolder(t);
      return collapse();
    }
    if (t) onAdd(t);
    // Stay open — adding several in a row is the common case on first launch.
    setDraft('');
  };

  return html`
    <div class="add-field ${mode ? 'expanded' : ''}" onClick=${() => !mode && setMode('activity')}>
      ${mode === 'folder' ? html`<${FolderPlusGlyph} />` : html`<${PlusCircle} />`}
      ${mode
        ? html`<input ref=${ref} placeholder=${mode === 'folder' ? 'New folder' : 'New activity'} value=${draft}
            onInput=${(e) => setDraft(e.currentTarget.value)}
            onKeyDown=${(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') collapse();
            }}
            onBlur=${() => !draft.trim() && collapse()} />`
        : html`<span>new activity</span>
            <span class="spacer" />
            <button class="add-folder" title="New folder"
              onClick=${(e) => { e.stopPropagation(); setMode('folder'); }}><${FolderPlusGlyph} /></button>`}
    </div>
  `;
}

// MARK: - History

/** Past weeks as small donuts, collapsed to a thin bar until you want it. */
function HistoryStrip({ weeks, selected, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const scroller = useRef();

  // Weeks run oldest → newest, so open at the right edge (this week).
  useLayoutEffect(() => {
    if (expanded && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [expanded]);

  // A plain mouse wheel only scrolls vertically; turn it sideways here.
  const onWheel = (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
  };

  return html`
    <div class="history">
      <button class="history-toggle" onClick=${() => setExpanded((v) => !v)}>
        <${Chevron} dir=${expanded ? 'down' : 'right'} size=${9} />
        <span class="grow">history</span>
        ${!expanded && html`
          <span class="minis">
            ${weeks.slice(-8).map((w) => html`
              <span key=${w.id} class=${w.totalMinutes === 0 ? 'faint' : ''}>
                <${Donut} slices=${w.slices} size=${16} compact />
              </span>`)}
          </span>`}
      </button>
      ${expanded && html`
        <div class="history-weeks" ref=${scroller} onWheel=${onWheel}>
          ${weeks.map((w) => html`
            <button key=${w.id} class="week-thumb ${w.id === selected ? 'selected' : ''}"
              title="Jump to ${w.label}" onClick=${() => onSelect(w.start)}>
              <span class=${w.totalMinutes === 0 ? 'faint' : ''}>
                <${Donut} slices=${w.slices} size=${34} compact />
              </span>
              <span class="label">${w.label}</span>
              <span class="mins num">${Duration.format(w.totalMinutes)}</span>
            </button>`)}
        </div>`}
    </div>
  `;
}

// MARK: - Friends (port of FriendsView.swift)

/**
 * A group's week as a leaderboard. It follows the week the window is on, so the
 * arrows move it like everything else.
 */
function FriendsView({ week }) {
  const friends = useFriends();
  // Starting or joining one more group, over the one on screen.
  const [adding, setAdding] = useState(false);
  const group = friends.current;
  // Keyed by group, so each starts fresh: nothing open, and its own drafts.
  return html`
    <div class="friends">
      ${group && !adding
        ? html`<${GroupPicker} onAdd=${() => setAdding(true)} />
          <${Leaderboard} key=${'board-' + group.code} standings=${friends.standings(week)} />
          <${GroupCard} key=${'card-' + group.code} group=${group} />`
        : html`<${JoinGroupCard} onDone=${() => setAdding(false)}
            onCancel=${friends.groups.length ? () => setAdding(false) : null} />`}
      ${friends.problem && html`<div class="friends-problem">⚠︎ ${friends.problem}</div>`}
    </div>
  `;
}

/** Which of your groups is on screen, and the way into another. */
function GroupPicker({ onAdd }) {
  const friends = useFriends();
  const groups = friends.groups;
  return html`
    <div class="group-picker">
      ${groups.length > 1 && groups.length <= 4 && html`
        <div class="segmented">
          ${groups.map((g) => html`
            <button key=${g.code} class=${g.code === friends.selectedCode ? 'on' : ''}
              onClick=${() => friends.select(g.code)}>${groupTitle(g)}</button>`)}
        </div>`}
      ${groups.length > 4 && html`
        <select class="field group-select" value=${friends.selectedCode}
          onChange=${(e) => friends.select(e.currentTarget.value)}>
          ${groups.map((g) => html`<option key=${g.code} value=${g.code}>${groupTitle(g)}</option>`)}
        </select>`}
      <span class="spacer" />
      <button class="btn" onClick=${onAdd} title="Start or join another group">+ Add Group</button>
    </div>
  `;
}

/** Ready for the donut. The ids only need to be stable within one person's week. */
const slicesOf = (standing) => (standing.week?.slices ?? []).map((s, i) => ({ id: i, ...s }));

function Leaderboard({ standings }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (id) => setExpanded((open) => {
    const next = new Set(open);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return html`
    <div class="card board">
      ${standings.map((s) => html`
        <div key=${s.id} class="standing ${s.total === 0 ? 'zero' : ''}">
          <div class="standing-summary" onClick=${() => s.total > 0 && toggle(s.id)}
            title=${s.total > 0 ? 'Click to see their week' : 'Nothing logged this week'}>
            <span class="place num ${s.place === 1 ? 'first' : ''}">${s.place ?? '–'}</span>
            <${Donut} slices=${slicesOf(s)} size=${22} compact />
            <span class="name ${s.isMe ? 'me' : ''}">${s.name}</span>
            ${s.isMe && html`<span class="you">You</span>`}
            ${s.live && html`<${LiveBadge} live=${s.live} />`}
            <span class="spacer" />
            <span class="standing-total num">${Duration.format(s.total)}</span>
          </div>
          ${expanded.has(s.id) && s.total > 0 && html`<${Breakdown} standing=${s} />`}
        </div>`)}
      ${standings.length === 1 && html`
        <div class="board-note">Nobody else is here yet. Send your friends the group code below.</div>`}
    </div>
  `;
}

/** A timer someone has running right now, counting up. */
function LiveBadge({ live }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return html`
    <span class="live" title="Timing this right now">
      <span class="dot" style=${{ background: slotColor(live.colorSlot) }} />
      ${live.name != null && html`<span class="what">${live.name}</span>`}
      <span class="num">${Duration.clock(Math.floor((now - live.startedAt) / 1000))}</span>
    </span>
  `;
}

/** One person's donut and what it's made of, biggest first. */
function Breakdown({ standing }) {
  const slices = slicesOf(standing);
  return html`
    <div class="breakdown">
      <${Donut} slices=${slices} size=${96} compact />
      <div class="breakdown-list">
        ${[...slices].sort((a, b) => b.minutes - a.minutes).map((s) => html`
          <div key=${s.id} class="breakdown-row">
            <span class="dot" style=${{ background: slotColor(s.colorSlot) }} />
            <span class="name ${s.name == null ? 'hidden-name' : ''}">${s.name ?? 'Hidden'}</span>
            <span class="spacer" />
            <span class="num">${Duration.format(s.minutes)}</span>
          </div>`)}
      </div>
    </div>
  `;
}

/**
 * The group on screen, how you appear in it, and the way out. Only the code shows until
 * you open the settings.
 */
function GroupCard({ group: s }) {
  const friends = useFriends();
  const [showingSettings, setShowingSettings] = useState(false);
  const [name, setName] = useState(s.name);
  const [label, setLabel] = useState(s.label ?? '');
  const [copied, setCopied] = useState(false);
  const drafts = useRef();
  drafts.current = { name, label };

  // Someone else renamed the group: follow them, unless you're typing a name yourself.
  const heardLabel = useRef(s.label ?? '');
  useEffect(() => {
    const now = s.label ?? '';
    if (label === heardLabel.current) setLabel(now);
    heardLabel.current = now;
  }, [s.label]);

  const commitDrafts = () => {
    friends.rename(s.code, drafts.current.name);
    friends.setLabel(s.code, drafts.current.label);
  };
  // Leaving the screen, or this group, keeps what you typed, as Enter would.
  useEffect(() => commitDrafts, []);
  // So does closing the settings.
  const toggleSettings = () => {
    if (showingSettings) commitDrafts();
    setShowingSettings(!showingSettings);
  };

  const copy = () => {
    api.copy(displayCode(s.code));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const leave = () => {
    if (confirm(`Leave ${groupTitle(s)}?\n\nYour weeks are removed from its leaderboard. You can join again with the code.`)) friends.leave();
  };
  const blurOnEnter = (e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); };

  return html`
    <div class="card group-card">
      <div class="group-head">
        <div>
          <div class="caption">Group code</div>
          <div class="code">${displayCode(s.code)}</div>
        </div>
        <span class="spacer" />
        <button class="btn" onClick=${copy}>${copied ? 'Copied' : 'Copy Code'}</button>
        <button class="btn" onClick=${() => api.openPage(friends.pageURL)}
          title="The same leaderboard as a web page, for checking on your phone">Open in Browser</button>
        <button class="btn icon" onClick=${toggleSettings}
          title=${showingSettings ? 'Hide group settings' : 'Group name, your name, and leaving'}>
          <span class="chevron ${showingSettings ? 'flipped' : ''}"><${Chevron} dir="down" /></span>
        </button>
      </div>
      ${showingSettings && html`
      <div class="divider" />
      <label class="setting" title="Everyone in the group sees this name">
        <span>Group name</span>
        <input class="field" placeholder=${displayCode(s.code)} value=${label}
          onInput=${(e) => setLabel(e.currentTarget.value)}
          onKeyDown=${blurOnEnter} onBlur=${() => friends.setLabel(s.code, label)} />
      </label>
      <label class="setting">
        <span>Your name</span>
        <input class="field" value=${name} onInput=${(e) => setName(e.currentTarget.value)}
          onKeyDown=${blurOnEnter} onBlur=${() => friends.rename(s.code, name)} />
      </label>
      <label class="setting" title="Friends still see your total and the coloured slices, but not what they're called">
        <span>Hide my activity names</span>
        <input type="checkbox" class="switch" checked=${s.hideNames}
          onChange=${(e) => friends.setHideNames(s.code, e.currentTarget.checked)} />
      </label>
      <div class="group-foot">
        <span class="caption">Shared: your name, the last 12 weeks’ totals per activity, and a running timer.</span>
        <span class="spacer" />
        <button class="btn danger" onClick=${leave}>Leave Group</button>
      </div>`}
    </div>
  `;
}

/**
 * Start a group, or join one with a code: the first, or one more. `onCancel` goes back
 * to the group on screen, and is null when there isn't one.
 */
function JoinGroupCard({ onDone, onCancel }) {
  const friends = useFriends();
  // The name you go by in your other groups, if you have any.
  const [name, setName] = useState(() => friends.groups.at(-1)?.name ?? '');
  const [code, setCode] = useState('');
  const hasName = name.trim().length > 0;
  const join = () => hasName && code && friends.join(code, name).then((ok) => ok && onDone());

  return html`
    <div class="card join-card">
      <div class="join-icon"><${PeopleGlyph} /></div>
      <div class="join-title">${onCancel ? 'Add another group' : 'Compare weeks with friends'}</div>
      <div class="join-text">Start a group and send its code to your friends, or join theirs.
        Only weekly totals are shared, never the individual entries.</div>
      <label class="setting narrow">
        <span>Your name</span>
        <input class="field" placeholder="Shown to the group" value=${name}
          onInput=${(e) => setName(e.currentTarget.value)} />
      </label>
      <button class="btn primary" disabled=${!hasName || friends.working}
        onClick=${() => friends.startGroup(name).then((ok) => ok && onDone())}>Start a Group</button>
      <div class="or"><span />or join one<span /></div>
      <div class="join-row">
        <input class="field code-field" placeholder="Group code" value=${code}
          onInput=${(e) => setCode(e.currentTarget.value)}
          onKeyDown=${(e) => e.key === 'Enter' && join()} />
        <button class="btn" disabled=${!hasName || !code || friends.working} onClick=${join}>Join</button>
      </div>
      ${friends.working && html`<div class="caption">Working…</div>`}
      ${onCancel && html`<button class="btn" onClick=${onCancel}>Cancel</button>`}
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('root'));
