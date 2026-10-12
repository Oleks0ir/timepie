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
        let isFolder: Bool
        /// Its place in the rows when picked up.
        let from: Int
        var offset: CGFloat
        /// Where the gap is, as an index into the rows without the lifted one.
        var slot: Int
        /// A folder the lifted task is held over, to drop it in.
        var into: UUID?
    }

    /// One line in the list as drawn.
    private enum Row: Identifiable {
        case folder(Folder, tasks: [Activity])
        case task(Activity, folder: UUID?)

        var id: UUID {
            switch self {
            case .folder(let folder, _): folder.id
            case .task(let activity, _): activity.id
            }
        }

        /// The folder a task sits in. Nil for folders and loose tasks: the top level.
        var parent: UUID? {
            if case .task(_, let folder) = self { return folder }
            return nil
        }
    }

    private var weekEnd: Date { WeekMath.weekEnd(for: viewedWeek) }
    private var outline: [OutlineItem] { store.outline(forWeek: viewedWeek) }

    /// Every task in the week in list order, hidden ones included — the chart's slices.
    private var activities: [Activity] {
        outline.flatMap { item -> [Activity] in
            switch item {
            case .folder(_, let tasks): tasks
            case .activity(let activity): [activity]
            }
        }
    }

    /// The rows on screen. A collapsed folder's tasks are left out, and so are the
    /// tasks of a folder being dragged — they travel with it.
    private func visibleRows(hidingTasksOf dragged: UUID? = nil) -> [Row] {
        let dragged = dragged ?? drag?.id
        return outline.flatMap { item -> [Row] in
            switch item {
            case .activity(let activity):
                return [.task(activity, folder: nil)]
            case .folder(let folder, let tasks):
                let hidden = folder.collapsed || folder.id == dragged
                return [.folder(folder, tasks: tasks)]
                    + (hidden ? [] : tasks.map { .task($0, folder: folder.id) })
            }
        }
    }

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
        let rows = visibleRows()
        return VStack(spacing: RowMetrics.spacing) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                let isDragged = drag?.id == row.id
                rowView(row, at: index)
                    .onHover { hoveredID = $0 ? row.id : nil }
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                        rowStride = $0 + RowMetrics.spacing
                    }
                    .offset(y: displacement(at: index))
                    .zIndex(isDragged ? 1 : 0)
                    // The lifted row tracks the cursor exactly; the others slide aside.
                    .animation(isDragged ? nil : .easeOut(duration: 0.15), value: drag?.slot)
            }

            AddActivityField(
                onAdd: { store.addActivity(named: $0, inWeek: viewedWeek) },
                onAddFolder: { store.addFolder(named: $0, inWeek: viewedWeek) }
            )
        }
        .padding(.horizontal, 16)
    }

    /// While dragging, the highlight stays on the lifted row rather than flickering
    /// across the rows it passes.
    private func isHighlighted(_ id: UUID) -> Bool {
        drag.map { $0.id == id } ?? (hoveredID == id)
    }

    @ViewBuilder
    private func rowView(_ row: Row, at index: Int) -> some View {
        switch row {
        case .folder(let folder, let tasks):
            FolderRow(
                name: folder.name,
                taskCount: tasks.count,
                minutes: tasks.reduce(0) { $0 + max(0, minutes(for: $1)) },
                isCollapsed: folder.collapsed,
                isHovered: isHighlighted(folder.id),
                isDragging: drag?.id == folder.id,
                isDropTarget: drag?.into == folder.id,
                runningSeconds: folder.collapsed
                    ? tasks.first { $0.id == running?.activityID }.map { elapsedSeconds(for: $0.id) }
                    : nil,
                onToggle: {
                    withAnimation(.easeOut(duration: 0.15)) {
                        store.setCollapsed(folder.id, !folder.collapsed)
                    }
                },
                onRename: { store.renameFolder(folder.id, to: $0) },
                onDelete: { withAnimation(.easeOut(duration: 0.15)) { store.deleteFolder(folder.id) } },
                onDragChanged: { dragRow(folder.id, isFolder: true, at: index, by: $0) },
                onDragEnded: endDrag
            )
        case .task(let activity, let folder):
            ActivityRow(
                name: activity.name,
                colorSlot: activity.colorSlot,
                minutes: minutes(for: activity),
                isHovered: isHighlighted(activity.id),
                isDragging: drag?.id == activity.id,
                // A lifted task shows the line when it would land in a folder.
                inFolder: (drag?.id == activity.id
                           ? drag.flatMap { dropTarget(of: $0).parent }
                           : folder) != nil,
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
                onDragChanged: { dragRow(activity.id, isFolder: false, at: index, by: $0) },
                onDragEnded: endDrag
            )
        }
    }

    // MARK: - Reordering

    private func dragRow(_ id: UUID, isFolder: Bool, at index: Int, by translation: CGFloat) {
        var lifted = drag ?? RowDrag(id: id, isFolder: isFolder, from: index,
                                     offset: 0, slot: index, into: nil)
        let others = visibleRows(hidingTasksOf: id).filter { $0.id != id }
        // Kept within the list, so the row can't be dragged off either end.
        let lowest = -CGFloat(lifted.from) * rowStride
        let highest = CGFloat(others.count - lifted.from) * rowStride
        lifted.offset = min(max(translation, lowest), highest)
        settle(&lifted, among: others)
        drag = lifted
    }

    /// Moves the gap to follow the lifted row, a place at a time once it covers more
    /// than half of its neighbour. A task passing over a folder pauses there instead:
    /// held over the middle of the folder's row, it would drop into the folder.
    private func settle(_ lifted: inout RowDrag, among others: [Row]) {
        // The lifted row's top edge, in rows.
        let top = lifted.offset / rowStride + CGFloat(lifted.from)
        lifted.into = nil
        while true {
            let down = top > CGFloat(lifted.slot)
            let overlap = abs(top - CGFloat(lifted.slot))
            let neighbour = down ? lifted.slot : lifted.slot - 1
            guard others.indices.contains(neighbour) else { return }

            if !lifted.isFolder, case .folder(let folder, _) = others[neighbour] {
                if overlap > 0.7 {
                    lifted.slot += down ? 1 : -1
                    continue
                }
                if overlap >= 0.3 { lifted.into = folder.id }
                return
            }
            guard overlap > 0.5 else { return }
            lifted.slot += down ? 1 : -1
        }
    }

    /// How far a row is pushed to open the gap; the lifted row follows the cursor.
    private func displacement(at index: Int) -> CGFloat {
        guard let drag else { return 0 }
        if index == drag.from { return drag.offset }
        let k = index < drag.from ? index : index - 1
        let shown = k < drag.slot ? k : k + 1
        return CGFloat(shown - index) * rowStride
    }

    /// Where the lifted row would land: in a folder or at the top level (nil), and
    /// its place among what this week shows there.
    private func dropTarget(of lifted: RowDrag) -> (parent: UUID?, index: Int) {
        if let into = lifted.into { return (into, .max) }
        let others = visibleRows(hidingTasksOf: lifted.id).filter { $0.id != lifted.id }
        let before = others.prefix(lifted.slot)
        let topLevel = before.filter { $0.parent == nil }.count
        // Folders don't nest; one dropped among a folder's tasks lands after it.
        if lifted.isFolder { return (nil, topLevel) }
        // Between two of a folder's tasks, or above its first: in that folder.
        if lifted.slot < others.count, let folder = others[lifted.slot].parent {
            return (folder, before.filter { $0.parent == folder }.count)
        }
        // Straight under an open folder that has nothing else in it.
        if case .folder(let folder, _)? = before.last, !folder.collapsed {
            return (folder.id, 0)
        }
        return (nil, topLevel)
    }

    private func endDrag() {
        guard let finished = drag else { return }
        let target = dropTarget(of: finished)
        // Moving the row and clearing its offset in one animated step means the
        // rows that slid aside stay put; only the lifted one settles into its slot.
        withAnimation(.easeOut(duration: 0.15)) {
            store.move(finished.id, into: target.parent, at: target.index, inWeek: viewedWeek)
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
