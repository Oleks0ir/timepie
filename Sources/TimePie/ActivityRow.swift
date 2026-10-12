import SwiftUI

/// One activity: identity carried by the colour dot, everything else in ink.
///
/// Laid out as three zones — name, total, controls. The outer two both expand
/// equally, so the fixed-width total column lands dead centre of the window and
/// stays aligned across every row regardless of how long the names are.
struct ActivityRow: View {
    let name: String
    let colorSlot: Int
    let minutes: Int
    let isHovered: Bool

    /// Live timer state. It lives only as long as the app does, so nothing here is persisted.
    let isRunning: Bool
    let elapsedSeconds: Int

    /// Slots already in use, so the picker can mark them rather than silently letting
    /// two activities wear the same colour.
    let takenSlots: Set<Int>

    let onAdd: (Int) -> Void
    /// The typed value is the activity's *week total*; the caller writes the difference.
    let onSetTotal: (Int) -> Void
    let onToggleTimer: () -> Void
    let onSetColor: (Int) -> Void
    let onRename: (String) -> Void
    let onDelete: () -> Void

    @State private var editingHours = false
    @State private var hoursDraft = ""
    @State private var editingName = false
    @State private var nameDraft = ""
    @State private var pickingColor = false

    private let totalColumnWidth: CGFloat = 96

    var body: some View {
        HStack(spacing: 10) {
            nameZone
                .frame(maxWidth: .infinity, alignment: .leading)

            totalZone
                .frame(width: totalColumnWidth)

            controlZone
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isHovered ? Color.primary.opacity(0.06) : .clear)
        )
        // Double-click anywhere on the row to start or stop its timer. Renaming moved
        // to the right-click menu because the old double-click-the-name gesture would
        // have collided with this one.
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { onToggleTimer() }
        .help(isRunning ? "Double-click to stop" : "Double-click to start a timer")
        .contextMenu {
            Button("Rename…") { nameDraft = name; editingName = true }
            Divider()
            Button("Delete", role: .destructive, action: onDelete)
        }
    }

    // MARK: - Zones

    private var nameZone: some View {
        HStack(spacing: 10) {
            Button { pickingColor = true } label: {
                Circle()
                    .fill(Palette.color(slot: colorSlot))
                    .frame(width: 11, height: 11)
                    .padding(3)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Change colour")
            .popover(isPresented: $pickingColor, arrowEdge: .bottom) {
                ColorSwatchPicker(current: colorSlot, taken: takenSlots) { slot in
                    onSetColor(slot)
                    pickingColor = false
                }
            }

            if editingName {
                TextField("", text: $nameDraft)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 160)
                    .onSubmit(commitName)
                    .onExitCommand { editingName = false }
            } else {
                Text(name)
                    .foregroundStyle(Ink.primary)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            // The running session, counting up. It lives in this zone so that starting
            // a timer never shifts the total column.
            if isRunning {
                Text(Duration.clock(seconds: elapsedSeconds))
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .foregroundStyle(Ink.secondary)
            }
        }
    }

    @ViewBuilder
    private var totalZone: some View {
        if editingHours {
            TextField("", text: $hoursDraft)
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.center)
                .onSubmit(commitHours)
                .onExitCommand { editingHours = false }
        } else {
            Text(Duration.format(minutes: minutes))
                .monospacedDigit()
                .foregroundStyle(minutes == 0 ? Ink.muted : Ink.secondary)
                .frame(maxWidth: .infinity, minHeight: 22)
                // Without this the number gives no sign it can be typed into.
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(isHovered ? Color.primary.opacity(0.09) : .clear)
                )
                .contentShape(Rectangle())
                // Both counts are claimed here so a double-click on the total edits it
                // instead of falling through to the row's start/stop-the-timer gesture.
                .onTapGesture(count: 2) { beginEditingHours() }
                .onTapGesture { beginEditingHours() }
                .help("Click to type this week's total — 1h45, 90, 1.5h, 2h")
        }
    }

    private var controlZone: some View {
        HStack(spacing: 6) {
            Button(action: onToggleTimer) {
                Image(systemName: isRunning ? "stop.fill" : "play.fill")
                    .font(.system(size: 10))
                    .frame(width: 14, height: 14)
                    .foregroundStyle(isRunning ? Palette.color(slot: colorSlot) : Ink.muted)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .help(isRunning ? "Stop and log this session" : "Start a timer")

            Button("+30m") { onAdd(30) }
                .buttonStyle(.bordered)
                .controlSize(.small)
            Button("+1h") { onAdd(60) }
                .buttonStyle(.bordered)
                .controlSize(.small)
        }
    }

    // MARK: - Commits

    private func beginEditingHours() {
        hoursDraft = minutes == 0 ? "" : Duration.format(minutes: minutes)
        editingHours = true
    }

    private func commitHours() {
        if let mins = Duration.parse(hoursDraft) { onSetTotal(mins) }
        editingHours = false
    }

    private func commitName() {
        let trimmed = nameDraft.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { onRename(trimmed) }
        editingName = false
    }
}

/// The eight validated palette slots plus the neutral overflow, as pickable swatches.
struct ColorSwatchPicker: View {
    let current: Int
    let taken: Set<Int>
    let onPick: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Colour")
                .font(.system(size: 11))
                .foregroundStyle(Ink.muted)

            HStack(spacing: 8) {
                ForEach(0...Palette.slotCount, id: \.self) { slot in
                    swatch(slot)
                }
            }

            Text("A dot marks a colour another activity already uses.")
                .font(.system(size: 10))
                .foregroundStyle(Ink.muted)
        }
        .padding(12)
    }

    private func swatch(_ slot: Int) -> some View {
        Button { onPick(slot) } label: {
            Circle()
                .fill(Palette.color(slot: slot))
                .frame(width: 18, height: 18)
                .overlay(
                    Circle()
                        .strokeBorder(Ink.primary.opacity(slot == current ? 0.85 : 0),
                                      lineWidth: 2)
                        .padding(-3)
                )
                .overlay(alignment: .bottom) {
                    if taken.contains(slot) && slot != current {
                        Circle()
                            .fill(Ink.muted)
                            .frame(width: 3, height: 3)
                            .offset(y: 6)
                    }
                }
                .padding(3)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(slot == Palette.slotCount ? "Neutral grey (past the eight-colour palette)"
                                        : "Palette colour \(slot + 1)")
    }
}

/// The inline `+` below the rows — a field you type into, never a dialog.
struct AddActivityField: View {
    let onAdd: (String) -> Void
    @State private var expanded = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus.circle")
                .foregroundStyle(Ink.muted)

            if expanded {
                TextField("New activity", text: $draft)
                    .textFieldStyle(.plain)
                    .focused($focused)
                    .onSubmit(commit)
                    .onExitCommand { collapse() }
            } else {
                Text("new activity")
                    .foregroundStyle(Ink.muted)
                Spacer()
            }
        }
        .padding(.vertical, 5)
        .padding(.horizontal, 8)
        .contentShape(Rectangle())
        .onTapGesture {
            expanded = true
            focused = true
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Ink.muted.opacity(expanded ? 0.4 : 0.15))
                .frame(height: 1)
        }
    }

    private func commit() {
        let trimmed = draft.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { onAdd(trimmed) }
        draft = ""
        // Stay open — adding several in a row is the common case on first launch.
        focused = true
    }

    private func collapse() {
        draft = ""
        expanded = false
        focused = false
    }
}
