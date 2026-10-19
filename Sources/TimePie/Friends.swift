import Foundation
import Observation

/// Comparing weeks with groups of friends.
///
/// Nothing leaves the computer until you start or join a group. From then on, every
/// change pushes a summary of your last twelve weeks to each group you're in — a total
/// and the slices, with the activity names left out if you'd rather — and never the
/// entries themselves. The server replaces your summary whole on each push, so it
/// can't drift from here.
///
/// Which groups you're in, and for each the id and secret token that let only this app
/// change your row, sit beside the data file in friends.json.
@MainActor
@Observable
final class Friends {
    /// One group you're in, and how you appear in it.
    struct Membership: Codable, Equatable, Identifiable {
        var code: String
        var memberID: UUID
        var token: String
        var name: String
        var hideNames: Bool = false
        /// The group's name, shared by everyone in it, as last heard from the server.
        var label: String?
        /// Whether `label` has been to the server. Not so for one named in 1.4.0, when names
        /// stayed on this computer.
        var labelShared: Bool?

        var id: String { code }
        var title: String {
            let trimmed = label?.trimmingCharacters(in: .whitespaces) ?? ""
            return trimmed.isEmpty ? Friends.display(code: code) : trimmed
        }
    }

    /// friends.json. Before there could be several groups it held one Membership alone.
    private struct SavedFile: Codable {
        var groups: [Membership]
        var selected: String?
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

    private(set) var groups: [Membership] = []
    /// The group on screen.
    private(set) var selectedCode: String?
    private var membersByGroup: [String: [Member]] = [:]
    /// The last thing that went wrong, worded for the person reading it.
    private(set) var problem: String?
    private(set) var isWorking = false
    /// What this app would send right now, names and all. Your own row is drawn from
    /// this rather than the server's copy, so it's never a push behind.
    private(set) var mine: [WeekSummary] = []

    private let fileURL: URL
    private var pushTask: Task<Void, Never>?
    /// Groups still owed the latest summary.
    private var pushPending: Set<String> = []
    /// Groups you renamed that the server hasn't heard about yet.
    private var namePending: Set<String> = []

    init(fileURL: URL? = nil) {
        self.fileURL = fileURL ?? Store.defaultFileURL()
            .deletingLastPathComponent()
            .appendingPathComponent("friends.json")
        if let data = try? Data(contentsOf: self.fileURL) {
            if let saved = try? JSONDecoder().decode(SavedFile.self, from: data) {
                groups = saved.groups
                selectedCode = saved.selected
            } else if let one = try? JSONDecoder().decode(Membership.self, from: data) {
                groups = [one]
            }
        }
        if current == nil { selectedCode = groups.first?.code }
    }

    var current: Membership? {
        groups.first { $0.code == selectedCode }
    }

    /// Everyone in the group on screen, as the server last said.
    var members: [Member] {
        selectedCode.flatMap { membersByGroup[$0] } ?? []
    }

    /// "ABCDEF" reads as "ABC-DEF".
    nonisolated static func display(code: String) -> String {
        code.count == 6 ? "\(code.prefix(3))-\(code.suffix(3))" : code
    }

    var pageURL: URL? {
        current.map { Friends.server.appendingPathComponent("g/\($0.code)") }
    }

    func select(_ code: String) {
        guard code != selectedCode, groups.contains(where: { $0.code == code }) else { return }
        selectedCode = code
        problem = nil
        save()
        Task { await refresh() }
    }

    // MARK: - Joining and leaving

    /// True once you're in the new group.
    @discardableResult
    func startGroup(name: String) async -> Bool {
        await run {
            let created: [String: String] = try await self.request("POST", "api/groups")
            guard let code = created["code"] else { throw Problem("The server didn't send a code.") }
            try await self.enter(code: code, name: name)
        }
    }

    /// True once you're in the group, including when you already were.
    @discardableResult
    func join(code raw: String, name: String) async -> Bool {
        let code = raw.uppercased().filter { $0.isLetter || $0.isNumber }
        guard code.count == 6 else {
            problem = "A group code is six letters and numbers, like ABC-DEF."
            return false
        }
        if groups.contains(where: { $0.code == code }) {
            select(code)
            return true
        }
        return await run {
            // Fetched first, so a mistyped code fails here rather than on the first push.
            let group: GroupResponse = try await self.request("GET", "api/groups/\(code)")
            self.membersByGroup[code] = group.members
            try await self.enter(code: code, name: name)
        }
    }

    private func enter(code: String, name: String) async throws {
        groups.append(Membership(code: code, memberID: UUID(), token: Friends.makeToken(),
                                 name: name.trimmingCharacters(in: .whitespaces)))
        selectedCode = code
        save()
        try await push(code)
        try await fetch(code)
    }

    /// Leaves the group on screen; the next one takes its place.
    func leave() async {
        guard let group = current else { return }
        // Even if the server can't be reached, this app stops sharing.
        _ = try? await request(
            "DELETE", "api/groups/\(group.code)/members/\(group.memberID.uuidString)",
            token: group.token) as Ignored
        forget(group.code)
        problem = nil
    }

    func rename(group code: String, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        update(code) { $0.name = trimmed.isEmpty ? $0.name : trimmed }
    }

    /// Names the group for everyone in it. An empty name goes back to showing the code.
    func setLabel(group code: String, to label: String) {
        let trimmed = label.trimmingCharacters(in: .whitespaces)
        guard let i = groups.firstIndex(where: { $0.code == code }),
              trimmed != (groups[i].label ?? "") else { return }
        groups[i].label = trimmed.isEmpty ? nil : trimmed
        save()
        namePending.insert(code)
        Task { await run { try await self.sendPendingNames() } }
    }

    func setHideNames(_ hide: Bool, group code: String) {
        update(code) { $0.hideNames = hide }
    }

    /// Changes what a group sees of you, and tells it.
    private func update(_ code: String, _ change: (inout Membership) -> Void) {
        guard let i = groups.firstIndex(where: { $0.code == code }) else { return }
        var group = groups[i]
        change(&group)
        guard group != groups[i] else { return }
        groups[i] = group
        save()
        schedulePush(to: [code], after: 0)
    }

    /// Drops a group from this app, whether you left it or it's gone from the server.
    private func forget(_ code: String) {
        groups.removeAll { $0.code == code }
        membersByGroup[code] = nil
        pushPending.remove(code)
        namePending.remove(code)
        if selectedCode == code { selectedCode = groups.first?.code }
        save()
    }

    // MARK: - Keeping in step

    /// Called whenever the data changes. Pushes are gathered up for a moment, so a run of
    /// quick clicks sends one request rather than a dozen.
    func storeChanged(_ store: Store, after delay: Double = 2, force: Bool = false) {
        let summaries = Friends.summaries(of: store)
        // Reordering or folding a folder changes nothing anyone else can see.
        guard force || summaries != mine else { return }
        mine = summaries
        schedulePush(to: groups.map(\.code), after: delay)
    }

    private func schedulePush(to codes: [String], after delay: Double) {
        pushPending.formUnion(codes)
        guard !pushPending.isEmpty else { return }
        pushTask?.cancel()
        pushTask = Task {
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await run { try await self.pushPendingGroups() }
        }
    }

    /// Fetches every group's weeks and name, the one on screen first, and sends anything
    /// an earlier attempt didn't get through.
    func refresh() async {
        guard let current else { return }
        await run {
            // One unreachable group shouldn't keep the others stale.
            var firstProblem: Error?
            func attempt(_ work: () async throws -> Void) async {
                do { try await work() } catch { firstProblem = firstProblem ?? error }
            }
            await attempt { try await self.pushPendingGroups() }
            let others = self.groups.map(\.code).filter { $0 != current.code }
            for code in [current.code] + others {
                await attempt { try await self.fetch(code) }
            }
            // After fetching, so a name from 1.4.0 found just now goes up straight away.
            await attempt { try await self.sendPendingNames() }
            if let firstProblem { throw firstProblem }
        }
    }

    /// Tries every group still owed a push, then reports the first thing that failed.
    private func pushPendingGroups() async throws {
        var firstProblem: Error?
        for code in pushPending.sorted() {
            do { try await push(code) } catch { firstProblem = firstProblem ?? error }
        }
        if let firstProblem { throw firstProblem }
    }

    private func push(_ code: String) async throws {
        guard let group = groups.first(where: { $0.code == code }) else {
            pushPending.remove(code)
            return
        }
        pushPending.insert(code)
        let weeks = group.hideNames ? Friends.hidingNames(mine) : mine
        do {
            let _: Ignored = try await request(
                "PUT", "api/groups/\(code)/members/\(group.memberID.uuidString)",
                body: PushBody(name: group.name, weeks: weeks), token: group.token)
        } catch let problem as Problem where problem.status == 404 {
            forget(code)
            throw Problem("\(group.title) no longer exists.")
        }
        pushPending.remove(code)
    }

    private func sendPendingNames() async throws {
        var firstProblem: Error?
        for code in namePending.sorted() {
            guard let group = groups.first(where: { $0.code == code }) else {
                namePending.remove(code)
                continue
            }
            do {
                let _: Ignored = try await request("PUT", "api/groups/\(code)",
                                                   body: ["name": group.label ?? ""], token: group.token)
                namePending.remove(code)
                if let i = groups.firstIndex(where: { $0.code == code }) {
                    groups[i].labelShared = true
                    save()
                }
            } catch {
                firstProblem = firstProblem ?? error
            }
        }
        if let firstProblem { throw firstProblem }
    }

    private func fetch(_ code: String) async throws {
        guard let group = groups.first(where: { $0.code == code }) else { return }
        do {
            let response: GroupResponse = try await request("GET", "api/groups/\(group.code)")
            membersByGroup[group.code] = response.members
            // A rename still on its way here wins over the name it's replacing.
            guard !namePending.contains(code), let i = groups.firstIndex(where: { $0.code == code }) else { return }
            if response.name == nil, groups[i].label != nil, groups[i].labelShared != true {
                // Named back when names stayed on this computer: share it now.
                namePending.insert(code)
            } else if groups[i].label != response.name || groups[i].labelShared != true {
                groups[i].label = response.name
                groups[i].labelShared = true
                save()
            }
        } catch let problem as Problem where problem.status == 404 {
            // The group is gone from the server; nothing to stay in.
            forget(group.code)
            throw Problem("\(group.title) no longer exists.")
        }
    }

    /// Everyone in the group on screen for one week, highest total first. Your own row
    /// uses what's on this computer, and is there even before the first push lands.
    func standings(week: Date) -> [Standing] {
        let key = DayStamp.string(from: WeekMath.weekStart(for: week))
        let me = current?.memberID.uuidString
        var rows = members.filter { $0.id != me }.map {
            Standing(id: $0.id, name: $0.name, isMe: false,
                     week: $0.weeks.first { $0.week == key })
        }
        if let group = current {
            let weeks = group.hideNames ? Friends.hidingNames(mine) : mine
            rows.append(Standing(id: group.memberID.uuidString, name: group.name, isMe: true,
                                 week: weeks.first { $0.week == key }))
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

    static func summaries(of store: Store) -> [WeekSummary] {
        let thisWeek = WeekMath.weekStart(for: Date())
        return (0..<weeksShared).compactMap { back in
            let start = WeekMath.addWeeks(-back, to: thisWeek)
            let end = WeekMath.weekEnd(for: start)
            let total = store.totalMinutes(from: start, to: end)
            guard total > 0 else { return nil }
            let slices = store.activities(forWeek: start).compactMap { activity -> SliceSummary? in
                let minutes = store.minutes(activityID: activity.id, from: start, to: end)
                guard minutes > 0 else { return nil }
                return SliceSummary(name: activity.name, minutes: minutes, colorSlot: activity.colorSlot)
            }
            return WeekSummary(week: DayStamp.string(from: start), total: total, slices: slices)
        }
    }

    /// The same weeks for a group you keep your activity names from.
    static func hidingNames(_ weeks: [WeekSummary]) -> [WeekSummary] {
        weeks.map { week in
            var week = week
            week.slices = week.slices.map { SliceSummary(name: nil, minutes: $0.minutes, colorSlot: $0.colorSlot) }
            return week
        }
    }

    // MARK: - Plumbing

    private func save() {
        if groups.isEmpty {
            try? FileManager.default.removeItem(at: fileURL)
        } else if let data = try? JSONEncoder().encode(SavedFile(groups: groups, selected: selectedCode)) {
            try? data.write(to: fileURL, options: .atomic)
        }
    }

    private static func makeToken() -> String {
        (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    /// Runs one piece of network work, turning whatever goes wrong into `problem`.
    /// True when it all went through.
    @discardableResult
    private func run(_ work: @escaping () async throws -> Void) async -> Bool {
        isWorking = true
        defer { isWorking = false }
        do {
            try await work()
            problem = nil
            return true
        } catch is CancellationError {
        } catch let p as Problem {
            problem = p.message
        } catch let e as URLError where e.code == .cancelled {
        } catch {
            problem = "Can't reach the TimePie server. Check your internet connection."
        }
        return false
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
        var name: String?
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
