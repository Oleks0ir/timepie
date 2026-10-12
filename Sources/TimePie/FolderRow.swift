import SwiftUI

/// A folder's header: click it to hide or show the tasks beneath it. It has no colour
/// or time of its own, so the total is its tasks' for the week and isn't editable.
///
/// Same three zones as `ActivityRow`, so the total column lines up with the tasks'.
struct FolderRow: View {
    let name: String
    let taskCount: Int
    let minutes: Int
    let isCollapsed: Bool
    let isHovered: Bool
    let isDragging: Bool
    /// A task is being held over this row and would drop into the folder.
    let isDropTarget: Bool
    /// A timer running on one of its tasks while they're hidden, so it stays visible.
    let runningSeconds: Int?

    let onToggle: () -> Void
    let onRename: (String) -> Void
    let onDelete: () -> Void
    let onDragChanged: (CGFloat) -> Void
    let onDragEnded: () -> Void

    @State private var editingName = false
    @State private var nameDraft = ""

    var body: some View {
        HStack(spacing: 10) {
            nameZone
                .frame(maxWidth: .infinity, alignment: .leading)

            Text(Duration.format(minutes: minutes))
                .monospacedDigit()
                .foregroundStyle(minutes == 0 ? Ink.muted : Ink.secondary)
                .frame(width: RowMetrics.totalColumnWidth, height: 22)

            DragHandle(isDragging: isDragging, onChanged: onDragChanged, onEnded: onDragEnded)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 8)
        .rowChrome(isHovered: isHovered || isDropTarget, isDragging: isDragging)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(Color.accentColor.opacity(isDropTarget ? 0.8 : 0), lineWidth: 1.5)
        )
        .contentShape(Rectangle())
        .onTapGesture { if !editingName { onToggle() } }
        .help(isCollapsed ? "Click to show its tasks" : "Click to hide its tasks")
        .contextMenu {
            Button("Rename…") { nameDraft = name; editingName = true }
            Divider()
            Button("Delete Folder (Keeps Its Tasks)", role: .destructive, action: onDelete)
        }
    }

    private var nameZone: some View {
        HStack(spacing: 6) {
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Ink.muted)
                .rotationEffect(.degrees(isCollapsed ? 0 : 90))
                .frame(width: RowMetrics.folderLineX * 2 + 1)

            Image(systemName: "folder.fill")
                .font(.system(size: 13))
                .foregroundStyle(Ink.secondary)

            if editingName {
                TextField("", text: $nameDraft)
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 160)
                    .onSubmit(commitName)
                    .onExitCommand { editingName = false }
            } else {
                Text(name)
                    .fontWeight(.medium)
                    .foregroundStyle(Ink.primary)
                    .lineLimit(1)
            }

            // Like Notes: the count says what's tucked away while the folder is shut.
            if isCollapsed && taskCount > 0 {
                Text("\(taskCount)")
                    .font(.system(size: 11))
                    .foregroundStyle(Ink.muted)
            }

            Spacer(minLength: 8)

            if let runningSeconds {
                Text(Duration.clock(seconds: runningSeconds))
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .foregroundStyle(Ink.secondary)
            }
        }
    }

    private func commitName() {
        let trimmed = nameDraft.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { onRename(trimmed) }
        editingName = false
    }
}
