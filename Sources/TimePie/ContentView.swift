import SwiftUI
import Combine

struct ContentView: View {
    @Environment(Store.self) private var store

    /// The week being viewed. Past weeks are fully editable — arrow back and log into them.
    @State private var viewedWeek = WeekMath.weekStart(for: Date())
    /// The day a click attributes to. Always inside the viewed week.
    @State private var loggingDay = WeekMath.startOfDay(Date())
    @State private var hoveredID: UUID?

    /// The row being dragged by its handle, and how far it has travelled.
    @State private var drag: RowDrag?
    /// One row's height plus the gap below it: how far a row moves per place.
    @State private var rowStride: CGFloat = 30

    /// A running timer, deliberately *not* persisted: it dies with the app. Nothing is
    /// written until you stop it, so a crash loses the session rather than inventing one.
    @State private var running: RunningTimer?
    /// Drives the once-a-second redraw while a timer runs.
    @State private var now = Date()
    /// Holds keyboard focus for the ← / → week shortcuts.
    @FocusState private var rootFocused: Bool

    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private struct RunningTimer {
        let activityID: UUID
        let startedAt: Date
        /// The day the timer *started* — a session running past midnight stays put
        /// rather than jumping into the next day, or the next week.
        let day: Date
    }

    private struct RowDrag {
        let id: UUID
        let from: Int
        var offset: CGFloat
    }

    private var weekEnd: Date { WeekMath.weekEnd(for: viewedWeek) }
    private var activities: [Activity] { store.activities(forWeek: viewedWeek) }

    var body: some View {
        VStack(spacing: 0) {
            header
            chart
            rows
            Spacer(minLength: 12)
            HistoryStrip(
                weeks: historyThumbs(),
                selectedWeekStart: viewedWeek,
                onSelect: { select(week: $0) }
            )
        }
        .frame(minWidth: 460, minHeight: 620)
        .background(Ink.background)
        .onReceive(tick) { instant in
            // Only redraw while something is actually running.
            if running != nil { now = instant }
        }
        // ← and → step through weeks. Focus lives here only when no text field has it,
        // so arrow keys still move the cursor while you're typing a name or an amount.
        .focusable()
        .focused($rootFocused)
        .focusEffectDisabled()
        .onAppear { rootFocused = true }
        .onKeyPress(.leftArrow) {
            select(week: WeekMath.addWeeks(-1, to: viewedWeek))
            return .handled
        }
        .onKeyPress(.rightArrow) {
            select(week: WeekMath.addWeeks(1, to: viewedWeek))
            return .handled
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 6) {
            stepper(back: { select(week: WeekMath.addWeeks(-1, to: viewedWeek)) },
                    forward: { select(week: WeekMath.addWeeks(1, to: viewedWeek)) }) {
                HStack(spacing: 6) {
                    Text(WeekMath.weekLabel(for: viewedWeek))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Ink.primary)
                    Text("·").foregroundStyle(Ink.muted)
                    Text(Duration.format(minutes: weekTotalMinutes))
                        .font(.system(size: 13))
                        .monospacedDigit()
                        .foregroundStyle(Ink.secondary)
                        .contentTransition(.numericText())
                        .animation(.easeInOut(duration: 0.35), value: weekTotalMinutes)
                }
            }
        }
        .padding(.top, 14)
        .padding(.bottom, 10)
    }

    private func stepper<Label: View>(
        back: @escaping () -> Void,
        forward: @escaping () -> Void,
        @ViewBuilder label: () -> Label
    ) -> some View {
        HStack(spacing: 2) {
            chevron("chevron.left", action: back)
            label()
                .padding(.horizontal, 6)
            chevron("chevron.right", action: forward)
        }
    }

    /// A 30×30 hit target around a small glyph — the arrows were previously only as
    /// clickable as the chevron was wide.
    private func chevron(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Ink.muted)
    }

    // MARK: - Chart

    private var chart: some View {
        DonutChart(slices: slices(), hoveredID: hoveredID, onHover: { hoveredID = $0 })
            .frame(height: 250)
            .padding(.horizontal, 24)
            .padding(.bottom, 20)
    }

    // MARK: - Rows

    private var rows: some View {
        VStack(spacing: rowSpacing) {
            ForEach(Array(activities.enumerated()), id: \.element.id) { index, activity in
                let isDragged = drag?.id == activity.id
                ActivityRow(
                    name: activity.name,
                    colorSlot: activity.colorSlot,
                    minutes: minutes(for: activity),
                    // While dragging, the highlight stays on the lifted row rather
                    // than flickering across the rows it passes.
                    isHovered: drag.map { $0.id == activity.id } ?? (hoveredID == activity.id),
                    isDragging: isDragged,
                    isRunning: running?.activityID == activity.id,
                    elapsedSeconds: elapsedSeconds(for: activity.id),
                    takenSlots: Set(activities.map(\.colorSlot)),
                    onAdd: { store.add(minutes: $0, to: activity.id, on: loggingDay) },
                    onSetTotal: {
                        store.setTotal($0, for: activity.id,
                                       weekStart: viewedWeek, weekEnd: weekEnd, on: loggingDay)
                    },
                    onToggleTimer: { toggleTimer(for: activity) },
                    onSetColor: { store.setColor(activity.id, to: $0) },
                    onRename: { store.rename(activity.id, to: $0) },
                    onDelete: {
                        // Don't leave a timer running against something that's gone.
                        if running?.activityID == activity.id { running = nil }
                        store.delete(activity.id, fromWeek: viewedWeek)
                    },
                    onDragChanged: { dragRow(activity.id, at: index, by: $0) },
                    onDragEnded: endDrag
                )
                .onHover { hoveredID = $0 ? activity.id : nil }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                    rowStride = $0 + rowSpacing
                }
                .offset(y: displacement(of: activity.id, at: index))
                .zIndex(isDragged ? 1 : 0)
                // The lifted row tracks the cursor exactly; the others slide aside.
                .animation(isDragged ? nil : .easeOut(duration: 0.15),
                           value: drag.map(dropIndex))
            }

            AddActivityField(onAdd: { store.addActivity(named: $0, inWeek: viewedWeek) })
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Reordering

    private let rowSpacing: CGFloat = 2

    private func dragRow(_ id: UUID, at index: Int, by translation: CGFloat) {
        // Kept within the list, so the row can't be dragged off either end.
        let lowest = -CGFloat(index) * rowStride
        let highest = CGFloat(activities.count - 1 - index) * rowStride
        drag = RowDrag(id: id, from: drag?.from ?? index,
                       offset: min(max(translation, lowest), highest))
    }

    /// The place the lifted row would take if dropped now.
    private func dropIndex(for drag: RowDrag) -> Int {
        let shift = Int((drag.offset / rowStride).rounded())
        return min(max(drag.from + shift, 0), activities.count - 1)
    }

    private func displacement(of id: UUID, at index: Int) -> CGFloat {
        guard let drag else { return 0 }
        if drag.id == id { return drag.offset }
        let to = dropIndex(for: drag)
        if drag.from < to, index > drag.from, index <= to { return -rowStride }
        if to < drag.from, index >= to, index < drag.from { return rowStride }
        return 0
    }

    private func endDrag() {
        guard let finished = drag else { return }
        // Moving the row and clearing its offset in one animated step means the
        // rows that slid aside stay put; only the lifted one settles into its slot.
        withAnimation(.easeOut(duration: 0.15)) {
            store.move(finished.id, to: dropIndex(for: finished), inWeek: viewedWeek)
            drag = nil
        }
    }

    // MARK: - The timer

    private func toggleTimer(for activity: Activity) {
        if running?.activityID == activity.id {
            stopTimer()
        } else {
            // One timer at a time: starting a new one logs and closes the old.
            stopTimer()
            now = Date()
            running = RunningTimer(activityID: activity.id,
                                   startedAt: now,
                                   day: WeekMath.startOfDay(now))
        }
    }

    private func stopTimer() {
        guard let timer = running else { return }
        running = nil
        let minutes = Int((Date().timeIntervalSince(timer.startedAt) / 60).rounded())
        // Anything under half a minute rounds to nothing and isn't worth an entry.
        guard minutes > 0 else { return }
        store.add(minutes: minutes, to: timer.activityID, on: timer.day)
    }

    private func elapsedSeconds(for id: UUID) -> Int {
        guard let timer = running, timer.activityID == id else { return 0 }
        return max(0, Int(now.timeIntervalSince(timer.startedAt)))
    }

    // MARK: - Derived data

    /// Logged time only. A running session stays out of the chart and the totals until
    /// it's stopped, then lands in one animated step — the row's stopwatch is where
    /// it counts up in the meantime.
    private func minutes(for activity: Activity) -> Int {
        store.minutes(activityID: activity.id, from: viewedWeek, to: weekEnd)
    }

    private var weekTotalMinutes: Int {
        store.totalMinutes(from: viewedWeek, to: weekEnd)
    }

    private func slices() -> [Slice] {
        activities.map {
            Slice(id: $0.id, name: $0.name,
                  minutes: max(0, minutes(for: $0)), colorSlot: $0.colorSlot)
        }
    }

    private func historyThumbs() -> [HistoryStrip.WeekThumb] {
        let thisWeek = WeekMath.weekStart(for: Date())
        return (-11...0).map { offset in
            let start = WeekMath.addWeeks(offset, to: thisWeek)
            let end = WeekMath.weekEnd(for: start)
            let slices = store.activities(forWeek: start).compactMap { activity -> Slice? in
                let mins = store.minutes(activityID: activity.id, from: start, to: end)
                guard mins > 0 else { return nil }
                return Slice(id: activity.id, name: activity.name,
                             minutes: mins, colorSlot: activity.colorSlot)
            }
            return HistoryStrip.WeekThumb(
                id: start,
                slices: slices,
                totalMinutes: store.totalMinutes(from: start, to: end),
                label: WeekMath.weekLabel(for: start)
            )
        }
    }

    // MARK: - Navigation

    private func select(week: Date) {
        viewedWeek = WeekMath.weekStart(for: week)
        // Keep the logging day inside the week you're looking at.
        loggingDay = WeekMath.isSameWeek(viewedWeek, Date())
            ? WeekMath.startOfDay(Date())
            : viewedWeek
    }
}
