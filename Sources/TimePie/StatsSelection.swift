import Foundation

/// The stretch of days the stats page shows, and how clicks on its calendar move it.
///
/// One click shows that day. A click on another day after it stretches the selection
/// into the interval between the two, and the click after that starts over with a day.
struct StatsSelection: Equatable {
    enum Mode: String, CaseIterable, Identifiable {
        case day = "Day"
        case month = "Month"
        case interval = "Interval"
        case allTime = "All Time"

        var id: Self { self }
    }

    private(set) var mode: Mode = .day
    /// The first and last day shown, both included.
    private(set) var start: Date
    private(set) var end: Date
    /// The month on the calendar, which needn't be the one selected.
    var shownMonth: Date
    /// The day last clicked: where Day and Interval begin when picked.
    private var focus: Date
    /// A day was just clicked, so the next click on another day makes an interval.
    private var anchored = false
    /// Interval was picked by hand, so every click goes on picking intervals rather
    /// than falling back to a single day.
    private var intervalPicked = false

    init(today: Date = Date()) {
        let day = WeekMath.startOfDay(today)
        start = day
        end = day
        focus = day
        shownMonth = WeekMath.monthStart(for: day)
    }

    /// The day after `end`, for queries that take a half-open range.
    var endExclusive: Date { WeekMath.addDays(1, to: end) }

    var dayCount: Int { WeekMath.days(from: start, to: end) + 1 }

    func contains(_ day: Date) -> Bool { day >= start && day <= end }

    /// What the next click does, while that isn't obvious.
    var hint: String? {
        switch (mode, anchored) {
        case (.interval, false) where start == end: "Click the first day"
        case (.interval, true): "Click the last day"
        case (.day, true): "Click another day to see the days between"
        default: nil
        }
    }

    mutating func click(_ date: Date) {
        let day = WeekMath.startOfDay(date)
        focus = day
        if anchored {
            guard day != start else { return }
            let first = start
            start = min(first, day)
            end = max(first, day)
            mode = .interval
            anchored = false
        } else {
            // An interval picked by hand stays one, waiting for its last day.
            mode = intervalPicked ? .interval : .day
            start = day
            end = day
            anchored = true
        }
    }

    /// `logged` is the first and last day with time on it, for All Time.
    mutating func pick(_ mode: Mode, logged: ClosedRange<Date>?, today: Date = Date()) {
        self.mode = mode
        anchored = false
        intervalPicked = mode == .interval
        switch mode {
        case .day, .interval:
            start = focus
            end = focus
        case .month:
            start = shownMonth
            end = WeekMath.addDays(-1, to: WeekMath.monthEnd(for: shownMonth))
        case .allTime:
            let today = WeekMath.startOfDay(today)
            start = min(logged?.lowerBound ?? today, today)
            end = max(logged?.upperBound ?? today, today)
            return
        }
        shownMonth = WeekMath.monthStart(for: start)
    }

    /// The previous or next day, month or interval of the same length.
    mutating func step(_ n: Int) {
        anchored = false
        switch mode {
        case .day:
            start = WeekMath.addDays(n, to: start)
            end = start
        case .month:
            start = WeekMath.addMonths(n, to: start)
            end = WeekMath.addDays(-1, to: WeekMath.monthEnd(for: start))
        case .interval:
            let length = dayCount
            start = WeekMath.addDays(n * length, to: start)
            end = WeekMath.addDays(n * length, to: end)
        case .allTime:
            return
        }
        focus = start
        shownMonth = WeekMath.monthStart(for: start)
    }

    // MARK: - Labels

    /// "Today", "Mon, Oct 26", "October 2026", "Oct 3 – 17", "All Time".
    var title: String {
        switch mode {
        case .allTime:
            return "All Time"
        case .month:
            return start.formatted(.dateTime.month(.wide).year())
        case .day, .interval:
            if start == end { return Self.dayTitle(start) }
            return Self.rangeTitle(start, end)
        }
    }

    /// The step the toolbar arrows take, for their labels.
    var unitName: String {
        switch mode {
        case .day: "Day"
        case .month: "Month"
        case .interval, .allTime: "Interval"
        }
    }

    private static func dayTitle(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInYesterday(day) { return "Yesterday" }
        return isThisYear(day)
            ? day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
            : day.formatted(.dateTime.month(.abbreviated).day().year())
    }

    /// Left to the system, which knows how a range of dates reads in your language.
    private static func rangeTitle(_ start: Date, _ end: Date) -> String {
        let style = Date.IntervalFormatStyle().month(.abbreviated).day()
        return (start..<end).formatted(isThisYear(start) && isThisYear(end) ? style : style.year())
    }

    private static func isThisYear(_ day: Date) -> Bool {
        let calendar = WeekMath.calendar
        return calendar.component(.year, from: day) == calendar.component(.year, from: Date())
    }
}
