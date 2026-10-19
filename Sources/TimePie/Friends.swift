import Foundation
import Observation

/// Comparing weeks with a group of friends.
///
/// Nothing leaves the computer until you start or join a group. From then on, every
/// change pushes a summary of your last twelve weeks — a total and the slices, with
/// the activity names left out if you'd rather — and never the entries themselves.
/// The server replaces your summary whole on each push, so it can't drift from here.
///
/// Which group you're in, and the id and secret token that let only this app change
/// your row, sit beside the data file in friends.json.
@MainActor
@Observable
final class Friends {
    struct Settings: Codable, Equatable {
        var code: String
        var memberID: UUID
        var token: String
        var name: String
        var hideNames: Bool = false
    }

    struct SliceSummary: Codable, Equatable {
        /// Nil when its owner keeps their activity names to themselves.
        var name: String?
        var minutes: Int
        var colorSlot: Int
    }

    /// One person's week. `week` is their own Monday, as a calendar date.
    struct WeekSummary: Codable, Equatable {
        var week: String
        var total: Int
        var slices: [SliceSummary]
    }

    struct Member: Codable, Identifiable, Equatable {
        var id: String
        var name: String
        var weeks: [WeekSummary]
    }

    static let server = URL(string: ProcessInfo.processInfo.environment["TIMEPIE_SERVER"]
                            ?? "https://timepie-friends.timepie.workers.dev")!
    private static let weeksShared = 12

    private(set) var settings: Settings?
    private(set) var members: [Member] = []
    /// The last thing that went wrong, worded for the person reading it.
    private(set) var problem: String?
    private(set) var isWorking = false
    /// What this app would send right now. Your own row is drawn from this rather than
    /// the server's copy, so it's never a push behind.
    private(set) var mine: [WeekSummary] = []

    private let fileURL: URL
    private var pushTask: Task<Void, Never>?
    private var pushPending = false

    init(fileURL: URL? = nil) {
        self.fileURL = fileURL ?? Store.defaultFileURL()
            .deletingLastPathComponent()
            .appendingPathComponent("friends.json")
        if let data = try? Data(contentsOf: self.fileURL) {
            settings = try? JSONDecoder().decode(Settings.self, from: data)
        }
    }

    /// "ABCDEF" reads as "ABC-DEF".
    static func display(code: String) -> String {
        code.count == 6 ? "\(code.prefix(3))-\(code.suffix(3))" : code
    }

    var pageURL: URL? {
        settings.map { Friends.server.appendingPathComponent("g/\($0.code)") }
    }

    // MARK: - Joining and leaving

    func startGroup(name: String) async {
        await run {
            let created: [String: String] = try await self.request("POST", "api/groups")
            guard let code = created["code"] else { throw Problem("The server didn't send a code.") }
            try await self.enter(code: code, name: name)
        }
    }

    func join(code raw: String, name: String) async {
        let code = raw.uppercased().filter { $0.isLetter || $0.isNumber }
        guard code.count == 6 else {
            problem = "A group code is six letters and numbers, like ABC-DEF."
            return
        }
        await run {
            // Fetched first, so a mistyped code fails here rather than on the first push.
            let group: GroupResponse = try await self.request("GET", "api/groups/\(code)")
            self.members = group.members
            try await self.enter(code: code, name: name)
        }
    }

    private func enter(code: String, name: String) async throws {
        save(Settings(code: code, memberID: UUID(), token: Friends.makeToken(),
                      name: name.trimmingCharacters(in: .whitespaces)))
        try await push()
        try await fetch()
    }

    func leave() async {
        guard let settings else { return }
        // Even if the server can't be reached, this app stops sharing.
        _ = try? await request(
            "DELETE", "api/groups/\(settings.code)/members/\(settings.memberID.uuidString)",
            token: settings.token) as Ignored
        save(nil)
        members = []
        problem = nil
    }

    func rename(to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard var s = settings, !trimmed.isEmpty, trimmed != s.name else { return }
        s.name = trimmed
        save(s)
        schedulePush(after: 0)
    }

    func setHideNames(_ hide: Bool, store: Store) {
        guard var s = settings, s.hideNames != hide else { return }
        s.hideNames = hide
        save(s)
        storeChanged(store, after: 0, force: true)
    }

    // MARK: - Keeping in step

    /// Called whenever the data changes. Pushes are gathered up for a moment, so a run of
    /// quick clicks sends one request rather than a dozen.
    func storeChanged(_ store: Store, after delay: Double = 2, force: Bool = false) {
        let summaries = Friends.summaries(of: store, hidingNames: settings?.hideNames ?? false)
        // Reordering or folding a folder changes nothing anyone else can see.
        guard force || summaries != mine else { return }
        mine = summaries
        schedulePush(after: delay)
    }

    private func schedulePush(after delay: Double) {
        guard settings != nil else { return }
        pushPending = true
        pushTask?.cancel()
        pushTask = Task {
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await run { try await self.push() }
        }
    }

    /// Fetches everyone's weeks, first sending ours if an earlier push didn't get through.
    func refresh() async {
        guard settings != nil else { return }
        await run {
            if self.pushPending { try await self.push() }
            try await self.fetch()
        }
    }

    private func push() async throws {
        guard let settings else { return }
        pushPending = true
        let body = PushBody(name: settings.name, weeks: mine)
        let _: Ignored = try await request(
            "PUT", "api/groups/\(settings.code)/members/\(settings.memberID.uuidString)",
            body: body, token: settings.token)
        pushPending = false
    }

    private func fetch() async throws {
        guard let settings else { return }
        do {
            let group: GroupResponse = try await request("GET", "api/groups/\(settings.code)")
            members = group.members
        } catch let problem as Problem where problem.status == 404 {
            // The group is gone from the server; nothing to stay in.
            save(nil)
            members = []
            throw Problem("That group no longer exists.")
        }
    }

    /// Everyone in the group for one week, highest total first. Your own row uses what's
    /// on this computer, and is there even before the first push lands.
    func standings(week: Date) -> [Standing] {
        let key = DayStamp.string(from: WeekMath.weekStart(for: week))
        let me = settings?.memberID.uuidString
        var rows = members.filter { $0.id != me }.map {
            Standing(id: $0.id, name: $0.name, isMe: false,
                     week: $0.weeks.first { $0.week == key })
        }
        if let settings {
            rows.append(Standing(id: settings.memberID.uuidString, name: settings.name, isMe: true,
                                 week: mine.first { $0.week == key }))
        }
        rows.sort {
            $0.total != $1.total ? $0.total > $1.total
                : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
        // Equal totals share a place; nobody places with nothing logged.
        var place = 0
        for i in rows.indices {
            if i == 0 || rows[i].total != rows[i - 1].total { place = i + 1 }
            rows[i].place = rows[i].total > 0 ? place : nil
        }
        return rows
    }

    struct Standing: Identifiable {
        let id: String
        let name: String
        let isMe: Bool
        let week: WeekSummary?
        var place: Int?

        var total: Int { week?.total ?? 0 }
        var namesHidden: Bool { week?.slices.contains { $0.name == nil } ?? false }

        /// Ready for the donut. The ids only need to be stable within one person's week.
        var slices: [Slice] {
            (week?.slices ?? []).enumerated().map { i, s in
                Slice(id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", i))!,
                      name: s.name ?? "Hidden", minutes: s.minutes, colorSlot: s.colorSlot)
            }
        }
    }

    // MARK: - Summaries

    static func summaries(of store: Store, hidingNames: Bool) -> [WeekSummary] {
        let thisWeek = WeekMath.weekStart(for: Date())
        return (0..<weeksShared).compactMap { back in
            let start = WeekMath.addWeeks(-back, to: thisWeek)
            let end = WeekMath.weekEnd(for: start)
            let total = store.totalMinutes(from: start, to: end)
            guard total > 0 else { return nil }
            let slices = store.activities(forWeek: start).compactMap { activity -> SliceSummary? in
                let minutes = store.minutes(activityID: activity.id, from: start, to: end)
                guard minutes > 0 else { return nil }
                return SliceSummary(name: hidingNames ? nil : activity.name,
                                    minutes: minutes, colorSlot: activity.colorSlot)
            }
            return WeekSummary(week: DayStamp.string(from: start), total: total, slices: slices)
        }
    }

    // MARK: - Plumbing

    private func save(_ new: Settings?) {
        settings = new
        if let new, let data = try? JSONEncoder().encode(new) {
            try? data.write(to: fileURL, options: .atomic)
        } else {
            try? FileManager.default.removeItem(at: fileURL)
        }
    }

    private static func makeToken() -> String {
        (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    /// Runs one piece of network work, turning whatever goes wrong into `problem`.
    private func run(_ work: @escaping () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await work()
            problem = nil
        } catch is CancellationError {
        } catch let p as Problem {
            problem = p.message
        } catch let e as URLError where e.code == .cancelled {
        } catch {
            problem = "Can't reach the TimePie server. Check your internet connection."
        }
    }

    private func request<T: Decodable>(_ method: String, _ path: String,
                                       body: (any Encodable)? = nil,
                                       token: String? = nil) async throws -> T {
        var req = URLRequest(url: Friends.server.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 15
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw Problem(message ?? "The server said no (\(status)).", status: status)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private struct GroupResponse: Decodable {
        var members: [Member]
    }

    private struct PushBody: Encodable {
        var name: String
        var weeks: [WeekSummary]
    }

    /// A response whose body doesn't matter.
    private struct Ignored: Codable {}

    private struct Problem: Error {
        let message: String
        var status = 0
        init(_ message: String, status: Int = 0) {
            self.message = message
            self.status = status
        }
    }
}
