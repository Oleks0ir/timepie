import AppKit
import SwiftUI

/// The group's week as a leaderboard, in place of your own chart and rows. It follows
/// the week the window is on, so the arrows and History move it like everything else.
struct FriendsView: View {
    let week: Date

    @Environment(Friends.self) private var friends

    var body: some View {
        VStack(spacing: 18) {
            if friends.settings == nil {
                JoinGroupCard()
            } else {
                Leaderboard(standings: friends.standings(week: week))
                GroupCard()
            }
            status
        }
    }

    @ViewBuilder
    private var status: some View {
        if let problem = friends.problem {
            Label(problem, systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(.secondary)
                .symbolRenderingMode(.multicolor)
                .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Leaderboard

private struct Leaderboard: View {
    let standings: [Friends.Standing]

    @State private var expanded: Set<String> = []
    @State private var hoveredID: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: RowMetrics.spacing) {
            ForEach(standings) { standing in
                VStack(spacing: 0) {
                    summary(standing)
                    if expanded.contains(standing.id) && standing.total > 0 {
                        Breakdown(standing: standing)
                            .transition(.opacity.combined(with: .offset(y: -6)))
                    }
                }
                .rowChrome(isHovered: hoveredID == standing.id, isDragging: false)
                .onHover { hoveredID = $0 ? standing.id : nil }
            }
            if standings.count == 1 {
                Text("Nobody else is here yet. Send your friends the group code below.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(12)
            }
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.quinary))
    }

    private func summary(_ standing: Friends.Standing) -> some View {
        HStack(spacing: 12) {
            Text(standing.place.map(String.init) ?? "–")
                .font(.system(size: 13, weight: standing.place == 1 ? .bold : .regular))
                .monospacedDigit()
                .foregroundStyle(standing.place == 1 ? AnyShapeStyle(Color.orange) : AnyShapeStyle(Ink.muted))
                .frame(width: 20)

            DonutChart(slices: standing.slices, compact: true)
                .frame(width: 22, height: 22)
                .allowsHitTesting(false)

            HStack(spacing: 6) {
                Text(standing.name)
                    .fontWeight(standing.isMe ? .semibold : .regular)
                    .lineLimit(1)
                if standing.isMe {
                    Text("You")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .foregroundStyle(standing.total == 0 ? .secondary : .primary)

            Spacer(minLength: 8)

            Text(Duration.format(minutes: standing.total))
                .monospacedDigit()
                .foregroundStyle(standing.total == 0 ? Ink.muted : Ink.secondary)
        }
        .padding(.vertical, 7)
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
        .onTapGesture {
            guard standing.total > 0 else { return }
            withAnimation(reduceMotion ? Motion.reduced : Motion.snappy) {
                if expanded.contains(standing.id) {
                    expanded.remove(standing.id)
                } else {
                    expanded.insert(standing.id)
                }
            }
        }
        .help(standing.total > 0 ? "Click to see their week" : "Nothing logged this week")
    }
}

/// One person's donut and what it's made of, biggest first.
private struct Breakdown: View {
    let standing: Friends.Standing

    @State private var hoveredID: UUID?

    var body: some View {
        let slices = standing.slices
        HStack(alignment: .center, spacing: 18) {
            DonutChart(slices: slices, hoveredID: hoveredID, onHover: { hoveredID = $0 })
                .frame(width: 150, height: 150)

            VStack(alignment: .leading, spacing: 5) {
                ForEach(slices.sorted { $0.minutes > $1.minutes }) { slice in
                    HStack(spacing: 8) {
                        Circle()
                            .fill(Palette.color(slot: slice.colorSlot))
                            .frame(width: 9, height: 9)
                        Text(slice.name)
                            .italic(standing.namesHidden)
                            .foregroundStyle(standing.namesHidden ? .secondary : .primary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(Duration.format(minutes: slice.minutes))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                    .font(.callout)
                    .padding(.vertical, 1)
                    .padding(.horizontal, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(hoveredID == slice.id ? Color.primary.opacity(0.06) : .clear)
                    )
                    .onHover { hoveredID = $0 ? slice.id : nil }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.leading, 40)
        .padding([.trailing, .bottom], 12)
        .padding(.top, 4)
    }
}

// MARK: - The group

/// Which group you're in, how you appear in it, and the way out.
private struct GroupCard: View {
    @Environment(Friends.self) private var friends
    @Environment(Store.self) private var store

    @State private var nameDraft = ""
    @State private var confirmingLeave = false
    @State private var copied = false

    var body: some View {
        if let settings = friends.settings {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Group code")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(Friends.display(code: settings.code))
                            .font(.system(size: 17, weight: .semibold, design: .monospaced))
                            .textSelection(.enabled)
                    }
                    Spacer()
                    Button(copied ? "Copied" : "Copy Code") { copy(settings.code) }
                    if let url = friends.pageURL {
                        Button("Open in Browser") { NSWorkspace.shared.open(url) }
                            .help("The same leaderboard as a web page, for checking on your phone")
                    }
                }

                Divider()

                LabeledContent("Your name") {
                    TextField("Name", text: $nameDraft)
                        .textFieldStyle(.roundedBorder)
                        .frame(maxWidth: 180)
                        .onSubmit { friends.rename(to: nameDraft) }
                }

                Toggle("Hide my activity names", isOn: Binding(
                    get: { settings.hideNames },
                    set: { friends.setHideNames($0, store: store) }
                ))
                .toggleStyle(.switch)
                .controlSize(.small)
                .help("Friends still see your total and the coloured slices, but not what they're called")

                HStack {
                    Text("Shared: your name and the last 12 weeks’ totals per activity.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button("Leave Group", role: .destructive) { confirmingLeave = true }
                }
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.quinary))
            .onAppear { nameDraft = settings.name }
            // Leaving the screen keeps the name you typed, as Return would.
            .onDisappear { friends.rename(to: nameDraft) }
            .confirmationDialog("Leave this group?", isPresented: $confirmingLeave) {
                Button("Leave Group", role: .destructive) { Task { await friends.leave() } }
            } message: {
                Text("Your weeks are removed from the leaderboard. You can join again with the code.")
            }
        }
    }

    private func copy(_ code: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(Friends.display(code: code), forType: .string)
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}

/// Before you're in a group: start one, or join one with a code.
private struct JoinGroupCard: View {
    @Environment(Friends.self) private var friends

    @State private var name = NSFullUserName().split(separator: " ").first.map(String.init) ?? ""
    @State private var code = ""

    private var hasName: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "person.2.fill")
                .font(.system(size: 34))
                .foregroundStyle(.tint)
                .symbolRenderingMode(.hierarchical)

            VStack(spacing: 6) {
                Text("Compare weeks with friends")
                    .font(.title3.weight(.semibold))
                Text("Start a group and send its code to your friends, or join theirs. Only weekly totals are shared, never the individual entries.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            LabeledContent("Your name") {
                TextField("Shown to the group", text: $name)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 200)
            }
            .frame(maxWidth: 300)

            Button {
                Task { await friends.startGroup(name: name) }
            } label: {
                Text("Start a Group").frame(minWidth: 140)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!hasName || friends.isWorking)

            HStack(spacing: 10) {
                Rectangle().fill(.quaternary).frame(height: 1)
                Text("or join one").font(.caption).foregroundStyle(.secondary).fixedSize()
                Rectangle().fill(.quaternary).frame(height: 1)
            }
            .frame(maxWidth: 300)

            HStack(spacing: 8) {
                TextField("Group code", text: $code)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
                    .frame(maxWidth: 140)
                    .onSubmit(join)
                Button("Join", action: join)
                    .disabled(!hasName || code.isEmpty || friends.isWorking)
            }

            if friends.isWorking {
                ProgressView().controlSize(.small)
            }
        }
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.quinary))
    }

    private func join() {
        guard hasName, !code.isEmpty else { return }
        Task { await friends.join(code: code, name: name) }
    }
}
