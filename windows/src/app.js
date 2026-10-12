// Port of ContentView, ActivityRow, DonutChart and HistoryStrip.
import { html, render, useState, useEffect, useLayoutEffect, useRef } from './vendor/preact-htm.js';
import * as W from './model.js';

const { Duration, SLOT_COUNT } = W;
const api = window.timepie;

const store = new W.Store(await api.load(), (json) => api.save(json));

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

// MARK: - Glyphs (stand-ins for the SF Symbols)

const Chevron = ({ dir, size = 12 }) => {
  const d = { left: 'M8 2 L4 6 L8 10', right: 'M4 2 L8 6 L4 10', down: 'M2 4 L6 8 L10 4' }[dir];
  return html`<svg width=${size} height=${size} viewBox="0 0 12 12" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d=${d} /></svg>`;
};
const PlayGlyph = () => html`<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1 L9 5 L2 9 Z" fill="currentColor" /></svg>`;
const StopGlyph = () => html`<svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" rx="1.2" fill="currentColor" /></svg>`;
const PlusCircle = () => html`<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2">
  <circle cx="7" cy="7" r="6" /><path d="M7 4 V10 M4 7 H10" stroke-linecap="round" /></svg>`;

// MARK: - App

function App() {
  const store = useStore();
  const [viewedWeek, setViewedWeek] = useState(() => W.weekStart(new Date()));
  // The day a click attributes to. Always inside the viewed week.
  const [loggingDay, setLoggingDay] = useState(() => W.startOfDay(new Date()));
  const [hoveredID, setHoveredID] = useState(null);
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
  const activities = store.activitiesForWeek(viewedWeek);
  const minutesFor = (a) => store.minutes(a.id, viewedWeek, weekEnd);
  const weekTotal = store.totalMinutes(viewedWeek, weekEnd);
  const takenSlots = new Set(activities.map((a) => a.colorSlot));

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
      </div>

      <div class="chart">
        <${Donut} slices=${slices} size=${250} hoveredID=${hoveredID} onHover=${setHoveredID} animate />
      </div>

      <div class="rows">
        ${activities.map((a) => html`
          <${ActivityRow}
            key=${a.id}
            activity=${a}
            minutes=${minutesFor(a)}
            isHovered=${hoveredID === a.id}
            isRunning=${running?.activityID === a.id}
            elapsedSeconds=${running?.activityID === a.id ? Math.max(0, Math.floor((now - running.startedAt) / 1000)) : 0}
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
          />`)}
        <${AddActivityField} onAdd=${(name) => store.addActivity(name, viewedWeek)} />
      </div>

      <${HistoryStrip} weeks=${thumbs} selected=${viewedWeek.getTime()} onSelect=${select} />
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
  const { activity, minutes, isHovered, isRunning, elapsedSeconds, takenSlots } = props;
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
    <div class="row ${isHovered ? 'hovered' : ''}"
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
      </div>
    </div>
  `;
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
function AddActivityField({ onAdd }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState('');
  const ref = useRef();

  useEffect(() => {
    if (expanded) ref.current?.focus();
  }, [expanded]);

  const collapse = () => {
    setDraft('');
    setExpanded(false);
  };

  return html`
    <div class="add-field ${expanded ? 'expanded' : ''}" onClick=${() => setExpanded(true)}>
      <${PlusCircle} />
      ${expanded
        ? html`<input ref=${ref} placeholder="New activity" value=${draft}
            onInput=${(e) => setDraft(e.currentTarget.value)}
            onKeyDown=${(e) => {
              if (e.key === 'Enter') {
                const t = draft.trim();
                if (t) onAdd(t);
                // Stay open — adding several in a row is the common case on first launch.
                setDraft('');
              }
              if (e.key === 'Escape') collapse();
            }}
            onBlur=${() => !draft.trim() && collapse()} />`
        : html`<span>new activity</span>`}
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

render(html`<${App} />`, document.getElementById('root'));
