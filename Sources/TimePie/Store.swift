import Foundation
import Observation

/// Everything lives in one human-readable JSON file.
///
/// ~/Library/Application Support/TimePie/timepie.json
///
/// A personal tracker accumulates a few thousand entries over years, so the whole
/// file is held in memory and rewritten atomically on every change. That keeps the
/// model honest and the file readable, which matters more here than write amplification.
@Observable
final class Store {
    private(set) var activities: [Activity] = []
    private(set) var entries: [Entry] = []

    private let fileURL: URL
    /// ⌘Z restores the previous state. Snapshots are uniform across every kind of
    /// edit — add, adjust, rename, archive — so undo never has to know what it is undoing.
    private var undoStack: [Payload] = []
    private let undoLimit = 50

    var canUndo: Bool { !undoStack.isEmpty }

    // MARK: - Lifecycle

    init(fileURL: URL? = nil) {
        self.fileURL = fileURL ?? Store.defaultFileURL()
        load()
    }

    static func defaultFileURL() -> URL {
        let base = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first ?? URL(fileURLWithPath: NSHomeDirectory())
        let dir = base.appendingPathComponent("TimePie", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("timepie.json")
    }

    var storeLocation: URL { fileURL }

    private static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let payload = try? Store.decoder().decode(Payload.self, from: data)
        else { return }
        activities = payload.activities
        entries = payload.entries

        // One-time cleanup. "Delete" used to mean "archive", which hid the activity from
        // the rows while its time still counted toward the header total and the history
        // thumbnails — the source of the 4h-vs-2h mismatch. Deleting now removes the
        // entries too, so anything already archived is purged here.
        let archived = Set(activities.filter(\.archived).map(\.id))
        if !archived.isEmpty {
            activities.removeAll { archived.contains($0.id) }
            entries.removeAll { archived.contains($0.activityID) }
            save()
        }
    }

    var payload: Payload {
        Payload(activities: activities, entries: entries)
    }

    private func save() {
        guard let data = try? Store.encoder().encode(payload) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Snapshot, mutate, persist — the single path every edit takes.
    private func mutate(_ block: () -> Void) {
        undoStack.append(payload)
        if undoStack.count > undoLimit { undoStack.removeFirst() }
        block()
        save()
    }

    func undo() {
        guard let previous = undoStack.popLast() else { return }
        activities = previous.activities
        entries = previous.entries
        save()
    }

    // MARK: - Reading

    var visibleActivities: [Activity] {
        activities.filter { !$0.archived }.sorted { $0.sortIndex < $1.sortIndex }
    }

    /// The list for one week: everything started on or before it, plus anything with
    /// time logged in it — so older weeks never lose a row that holds their hours.
    /// Activities deleted in this week or an earlier one are left out.
    func activities(forWeek weekStart: Date) -> [Activity] {
        let end = WeekMath.weekEnd(for: weekStart)
        let logged = Set(entries(from: weekStart, to: end).map(\.activityID))
        return visibleActivities.filter {
            if let ended = $0.endWeekStart, ended <= weekStart { return false }
            return $0.firstWeekStart <= weekStart || logged.contains($0.id)
        }
    }

    func entries(from start: Date, to end: Date) -> [Entry] {
        entries.filter { $0.day >= start && $0.day < end }
    }

    func minutes(activityID: UUID, from start: Date, to end: Date) -> Int {
        entries(from: start, to: end)
            .filter { $0.activityID == activityID }
            .reduce(0) { $0 + $1.minutes }
    }

    /// Counts only entries belonging to an activity that still exists, so the header
    /// total can never disagree with the sum of the donut's wedges.
    func totalMinutes(from start: Date, to end: Date) -> Int {
        let known = Set(activities.map(\.id))
        return max(0, entries(from: start, to: end)
            .filter { known.contains($0.activityID) }
            .reduce(0) { $0 + $1.minutes })
    }

    // MARK: - Writing

    func add(minutes: Int, to activityID: UUID, on day: Date) {
        mutate {
            entries.append(Entry(activityID: activityID,
                                 day: WeekMath.startOfDay(day),
                                 minutes: minutes))
        }
    }

    /// The typed value is a week *total*; the difference is written as an adjustment
    /// dated to the currently selected logging day.
    func setTotal(_ target: Int, for activityID: UUID,
                  weekStart: Date, weekEnd: Date, on day: Date) {
        let current = minutes(activityID: activityID, from: weekStart, to: weekEnd)
        let delta = target - current
        guard delta != 0 else { return }
        mutate {
            entries.append(Entry(activityID: activityID,
                                 day: WeekMath.startOfDay(day),
                                 minutes: delta,
                                 isAdjustment: true))
        }
    }

    func addActivity(named name: String, inWeek weekStart: Date) {
        mutate {
            // Only colours on screen in this week are off the table, so older, unrelated
            // activities don't use up the eight slots forever.
            let taken = activities(forWeek: weekStart).map(\.colorSlot)
            let nextIndex = (activities.map(\.sortIndex).max() ?? -1) + 1
            activities.append(Activity(
                name: name,
                colorSlot: Palette.nextSlot(taken: taken),
                sortIndex: nextIndex,
                firstWeek: DayStamp.string(from: WeekMath.weekStart(for: weekStart))
            ))
        }
    }

    /// Colour follows the entity, so changing it is an explicit act — never something
    /// that happens because an activity's rank or position changed.
    func setColor(_ id: UUID, to slot: Int) {
        guard let i = activities.firstIndex(where: { $0.id == id }) else { return }
        mutate { activities[i].colorSlot = slot }
    }

    func rename(_ id: UUID, to name: String) {
        guard let i = activities.firstIndex(where: { $0.id == id }) else { return }
        mutate { activities[i].name = name }
    }

    /// Deleting from a week removes the activity from that week and every later one,
    /// along with the time logged there. Earlier weeks keep the row and their hours.
    /// If no earlier week ever showed it, nothing is worth keeping and it goes entirely.
    /// ⌘Z restores all of it, since `mutate` snapshots the whole payload first.
    func delete(_ id: UUID, fromWeek weekStart: Date) {
        guard let i = activities.firstIndex(where: { $0.id == id }) else { return }
        let start = WeekMath.weekStart(for: weekStart)
        let shownEarlier = activities[i].firstWeekStart < start
            || entries.contains { $0.activityID == id && $0.day < start }
        mutate {
            entries.removeAll { $0.activityID == id && $0.day >= start }
            if shownEarlier {
                activities[i].endWeek = DayStamp.string(from: start)
            } else {
                activities.remove(at: i)
            }
        }
    }

    func move(fromOffsets source: IndexSet, toOffset destination: Int) {
        mutate {
            var visible = visibleActivities
            visible.move(fromOffsets: source, toOffset: destination)
            for (index, activity) in visible.enumerated() {
                if let i = activities.firstIndex(where: { $0.id == activity.id }) {
                    activities[i].sortIndex = index
                }
            }
        }
    }
}
