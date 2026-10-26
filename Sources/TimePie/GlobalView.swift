import SwiftUI

/// The board everyone using TimePie can join: one week's totals, highest first. It
/// follows the week the window is on, like the friends page. Joining asks for a name
/// and spells out what leaves the computer.
struct GlobalView: View {
    let week: Date

    @Environment(Friends.self) private var friends

    var body: some View {
        VStack(spacing: 18) {
            if let me = friends.global {
                GlobalBoardList(board: friends.globalBoard(week: week), myID: me.memberID.uuidString,
                                myName: me.name)
                GlobalYouCard(membership: me)
            } else {
                JoinGlobalCard()
            }
            if let problem = friends.problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .symbolRenderingMode(.multicolor)
                    .frame(maxWidth: .infinity)
            }
        }
        // Kept current while it's on screen, and fetched afresh for each week.
        .task(id: friends.global == nil ? nil : WeekMath.weekStart(for: week)) {
            guard friends.global != nil else { return }
            while !Task.isCancelled {
                await friends.refreshGlobal(week: week)
                try? await Task.sleep(for: .seconds(60))
            }
        }
    }
}

// MARK: - The board

private struct GlobalBoardList: View {
    let board: Friends.GlobalBoard?
    let myID: String
    let myName: String

    var body: some View {
        VStack(spacing: 8) {
            VStack(spacing: RowMetrics.spacing) {
                if let board {
                    ForEach(board.top) { row in
                        line(place: row.place, name: row.name, total: row.total, isMe: row.id == myID)
                    }
                    if board.top.isEmpty {
                        Text("Nobody has logged time this week yet.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(12)
                    }
                    // Below the top of the board, your own place still shows, under a gap.
                    if let me = board.me, !board.top.contains(where: { $0.id == myID }) {
                        Image(systemName: "ellipsis")
                            .foregroundStyle(Ink.muted)
                            .padding(.vertical, 2)
                        line(place: me.place, name: myName, total: me.total, isMe: true)
                    }
                } else {
                    ProgressView()
                        .controlSize(.small)
                        .padding(14)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(6)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.quinary))

            if let board, board.count > 0 {
                Text(board.count == 1 ? "1 person logged time this week"
                     : "\(board.count) people logged time this week")
                    .font(.caption)
                    .foregroundStyle(Ink.muted)
            }
        }
    }

    private func line(place: Int, name: String, total: Int, isMe: Bool) -> some View {
        HStack(spacing: 12) {
            Text("\(place)")
                .font(.system(size: 13, weight: place == 1 ? .bold : .regular))
                .monospacedDigit()
                .foregroundStyle(place == 1 ? AnyShapeStyle(Color.orange) : AnyShapeStyle(Ink.muted))
                .frame(minWidth: 20)
            HStack(spacing: 6) {
                Text(name)
                    .fontWeight(isMe ? .semibold : .regular)
                    .lineLimit(1)
                if isMe {
                    Text("You")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            Text(Duration.format(minutes: total))
                .monospacedDigit()
                .foregroundStyle(Ink.secondary)
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(isMe ? Color.accentColor.opacity(0.12) : .clear)
        )
    }
}

// MARK: - You on it

/// The name you go by on the board, what it shows of you, and the way off it.
private struct GlobalYouCard: View {
    let membership: Friends.GlobalMembership

    @Environment(Friends.self) private var friends
    @State private var nameDraft = ""
    @State private var confirmingLeave = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            LabeledContent("Your name") {
                TextField("Name", text: $nameDraft)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 200)
                    .onSubmit { friends.renameGlobal(to: nameDraft) }
            }
            HStack(alignment: .firstTextBaseline) {
                Text("Shared with everyone: this name and your total time for each of the last 12 weeks.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button("Leave", role: .destructive) { confirmingLeave = true }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.quinary))
        .onAppear { nameDraft = membership.name }
        // Leaving the screen keeps what you typed, as Return would.
        .onDisappear { friends.renameGlobal(to: nameDraft) }
        .confirmationDialog("Leave the leaderboard?", isPresented: $confirmingLeave) {
            Button("Leave Leaderboard", role: .destructive) { Task { await friends.leaveGlobal() } }
        } message: {
            Text("Your name and weekly totals are deleted from the server. You can join again any time.")
        }
    }
}

/// What joining means, before anything is sent.
private struct JoinGlobalCard: View {
    @Environment(Friends.self) private var friends
    @State private var name = ""

    private var hasName: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "trophy.fill")
                .font(.system(size: 34))
                .foregroundStyle(.tint)
                .symbolRenderingMode(.hierarchical)

            VStack(spacing: 6) {
                Text("Leaderboard")
                    .font(.title3.weight(.semibold))
                Text("See how your week compares with everyone using TimePie.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("If you join, anyone using TimePie can see:")
                    .font(.callout.weight(.medium))
                Label("The name you enter below", systemImage: "person")
                Label("Your total time for each of the last 12 weeks, kept up to date as you log",
                      systemImage: "clock")
                Text("Never what you worked on, how your time splits up, your entries or a running timer. Leaving deletes it all from the server.")
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
            }
            .font(.callout)
            .fixedSize(horizontal: false, vertical: true)
            .padding(12)
            .frame(maxWidth: 360, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.quinary))

            LabeledContent("Your name") {
                TextField("Shown to everyone", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 200)
                    .onSubmit(join)
            }
            .frame(maxWidth: 300)

            Button(action: join) {
                Text("Join the Leaderboard").frame(minWidth: 160)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!hasName || friends.isWorking)

            if friends.isWorking {
                ProgressView().controlSize(.small)
            }
        }
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.quinary))
        // The name you go by in your groups, if you're in any.
        .onAppear { name = friends.groups.last?.name ?? "" }
    }

    private func join() {
        guard hasName, !friends.isWorking else { return }
        Task { await friends.joinGlobal(name: name) }
    }
}
