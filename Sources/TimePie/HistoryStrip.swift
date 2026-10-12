import SwiftUI

/// Past weeks as small donuts. Collapsed to a thin bar by default so it costs almost
/// no height until you want it.
struct HistoryStrip: View {
    let weeks: [WeekThumb]
    let selectedWeekStart: Date
    let onSelect: (Date) -> Void

    @State private var expanded = false

    struct WeekThumb: Identifiable {
        let id: Date          // week start
        let slices: [Slice]
        let totalMinutes: Int
        let label: String
    }

    var body: some View {
        VStack(spacing: 0) {
            Divider()

            Button {
                withAnimation(.easeOut(duration: 0.15)) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                    Text("history")
                    Spacer()
                    if !expanded {
                        HStack(spacing: 5) {
                            ForEach(weeks.suffix(8)) { week in
                                DonutChart(slices: week.slices, compact: true)
                                    .frame(width: 16, height: 16)
                                    .allowsHitTesting(false)
                                    .opacity(week.totalMinutes == 0 ? 0.3 : 1)
                            }
                        }
                    }
                }
                .font(.system(size: 11))
                .foregroundStyle(Ink.muted)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(weeks) { week in
                            Button { onSelect(week.id) } label: {
                                VStack(spacing: 5) {
                                    DonutChart(slices: week.slices, compact: true)
                                        .frame(width: 34, height: 34)
                                        // The chart's own hover handlers were eating the
                                        // click before this button ever saw it.
                                        .allowsHitTesting(false)
                                        .opacity(week.totalMinutes == 0 ? 0.3 : 1)
                                    Text(week.label)
                                        .font(.system(size: 9))
                                        .foregroundStyle(Ink.muted)
                                    Text(Duration.format(minutes: week.totalMinutes))
                                        .font(.system(size: 9))
                                        .monospacedDigit()
                                        .foregroundStyle(Ink.muted.opacity(0.7))
                                }
                                .padding(8)
                                .background(
                                    RoundedRectangle(cornerRadius: 6)
                                        .fill(week.id == selectedWeekStart
                                              ? Color.primary.opacity(0.08) : .clear)
                                )
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .help("Jump to \(week.label)")
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 10)
                }
                // Weeks run oldest → newest, so open at the right edge (this week).
                .defaultScrollAnchor(.trailing)
                .frame(height: 86)
            }
        }
    }
}
