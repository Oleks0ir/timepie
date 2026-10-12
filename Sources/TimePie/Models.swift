import Foundation

/// An activity is a durable identity. Its colour slot is stored on the entity, never
/// derived from rank — reordering or archiving must never repaint the survivors.
struct Activity: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var name: String
    var colorSlot: Int
    var sortIndex: Int
    var archived: Bool = false
    var createdAt: Date = Date()
    /// The week this activity first appears in, as a calendar date ("2026-09-14") for
    /// the same drift reason as `Entry.day`. It shows in that week and every later one,
    /// so a new week inherits last week's list without copying anything. Nil for
    /// activities made before weeks had their own lists — those fall back to `createdAt`.
    var firstWeek: String?
    /// The week this activity was deleted from, stored the same way as `firstWeek`. It
    /// is gone from that week and every later one, but earlier weeks keep the row and
    /// its hours. Nil means it runs on indefinitely.
    var endWeek: String?
    /// The folder it sits in, if any. Shared by every week, like the order.
    var folderID: UUID?

    var firstWeekStart: Date {
        WeekMath.weekStart(for: firstWeek.map(DayStamp.parse) ?? createdAt)
    }

    var endWeekStart: Date? {
        endWeek.map { WeekMath.weekStart(for: DayStamp.parse($0)) }
    }
}

/// A named group of activities, drawn as a row that hides or shows the tasks beneath
/// it. Membership lives on the activity (`folderID`), so a folder holds no time of its
/// own, and deleting one only lets its tasks out.
struct Folder: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var name: String
    /// Ordered alongside the activities that aren't in a folder.
    var sortIndex: Int
    /// Whether its tasks are hidden. Shared by every week.
    var collapsed: Bool = false
    var createdAt: Date = Date()
    /// The week it was made in, as for `Activity.firstWeek`. Earlier weeks show it only
    /// if one of its tasks is in them.
    var firstWeek: String?

    var firstWeekStart: Date {
        WeekMath.weekStart(for: firstWeek.map(DayStamp.parse) ?? createdAt)
    }
}

/// One logged amount of time, stamped with the day it belongs to.
///
/// This is the whole storage model: a week is a *filter* over entries, not a stored
/// object. Monday's chart is empty with no reset logic, no week is ever destroyed,
/// and day-level breakdowns come free later.
///
/// `minutes` may be negative — that is how a correction is recorded.
struct Entry: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var activityID: UUID
    /// Normalised to start-of-day. The day the time was *spent*, not when it was typed.
    ///
    /// Written to disk as a bare calendar date ("2026-09-16"), never a timestamp.
    /// A timestamp would encode local midnight as the *previous* evening in UTC, so
    /// the file read a day early — and worse, crossing a timezone could have moved an
    /// entry into an adjacent week. A calendar date cannot drift.
    var day: Date
    var minutes: Int
    var isAdjustment: Bool = false
    var createdAt: Date = Date()

    init(id: UUID = UUID(), activityID: UUID, day: Date, minutes: Int,
         isAdjustment: Bool = false, createdAt: Date = Date()) {
        self.id = id
        self.activityID = activityID
        self.day = day
        self.minutes = minutes
        self.isAdjustment = isAdjustment
        self.createdAt = createdAt
    }

    // Hand-writing both init(from:) and encode(to:) suppresses synthesis of this enum,
    // so it has to be declared.
    enum CodingKeys: String, CodingKey {
        case id, activityID, day, minutes, isAdjustment, createdAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        activityID = try c.decode(UUID.self, forKey: .activityID)
        minutes = try c.decode(Int.self, forKey: .minutes)
        isAdjustment = try c.decode(Bool.self, forKey: .isAdjustment)
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        day = DayStamp.parse(try c.decode(String.self, forKey: .day))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(activityID, forKey: .activityID)
        try c.encode(minutes, forKey: .minutes)
        try c.encode(isAdjustment, forKey: .isAdjustment)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(DayStamp.string(from: day), forKey: .day)
    }
}

/// Calendar dates on disk, in the user's own timezone.
enum DayStamp {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        f.isLenient = false
        return f
    }()

    static func string(from date: Date) -> String {
        formatter.string(from: date)
    }

    static func parse(_ raw: String) -> Date {
        // Length-checked first: a fixed-format DateFormatter will happily parse the
        // "2026-09-15" prefix out of a full timestamp and silently return the wrong day.
        if raw.count == 10, let d = formatter.date(from: raw) { return d }

        // Legacy timestamps written before this format change. The stored instant *was*
        // local midnight, so converting it back in local time recovers the right day.
        if let d = ISO8601DateFormatter().date(from: raw) {
            return Calendar.current.startOfDay(for: d)
        }
        return Calendar.current.startOfDay(for: Date())
    }
}

/// The on-disk shape — and the export shape. They are deliberately the same file
/// format, so the thing the app saves is already the thing you can read.
struct Payload: Codable {
    var version: Int = 1
    var activities: [Activity] = []
    var entries: [Entry] = []
    var folders: [Folder] = []
}

extension Payload {
    /// Files written before folders existed have no `folders` key. Declared in an
    /// extension so the memberwise initialiser survives.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        activities = try c.decodeIfPresent([Activity].self, forKey: .activities) ?? []
        entries = try c.decodeIfPresent([Entry].self, forKey: .entries) ?? []
        folders = try c.decodeIfPresent([Folder].self, forKey: .folders) ?? []
    }
}

/// One entry in a week's list: a folder with the tasks it holds that week, or a task
/// that isn't in a folder.
enum OutlineItem: Identifiable {
    case folder(Folder, [Activity])
    case activity(Activity)

    var id: UUID {
        switch self {
        case .folder(let folder, _): folder.id
        case .activity(let activity): activity.id
        }
    }
}
