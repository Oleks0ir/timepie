import SwiftUI

/// Past weeks as small donuts, on a glass panel floating over the bottom of the list.
/// Collapsed to a single slim line by default so it costs almost no height until you
/// want it.
struct HistoryStrip: View {
    let weeks: [WeekThumb]
    let selectedWeekStart: Date
    let onSelect: (Date) -> Void

    @State private var expanded = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    struct WeekThumb: Identifiable {
        let id: Date          // week start
        let slices: [Slice]
        let totalMinutes: Int
        let label: String
    }

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(reduceMotion ? Motion.reduced : Motion.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                    Text("History")
                        .font(.system(size: 12, weight: .medium))
                    Spacer()
                    if !expanded {
                        HStack(spacing: 6) {
                            ForEach(weeks.suffix(8)) { week in
                                DonutChart(slices: week.slices, compact: true)
                                    .frame(width: 16, height: 16)
                                    .opacity(week.totalMinutes == 0 ? 0.35 : 1)
                                    .padding(2)
                                    .overlay(
                                        Circle().strokeBorder(.tint, lineWidth: 1.5)
                                            .opacity(week.id == selectedWeekStart ? 1 : 0)
                                    )
                                    .allowsHitTesting(false)
                            }
                        }
                        .transition(.opacity)
                    }
                }
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 6) {
                        ForEach(weeks) { week in
                            weekButton(week)
                        }
                    }
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
                }
                // Weeks run oldest → newest, so open at the right edge (this week).
                .defaultScrollAnchor(.trailing)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .glassPanel(cornerRadius: 18)
    }

    private func weekButton(_ week: WeekThumb) -> some View {
        let selected = week.id == selectedWeekStart
        return Button { onSelect(week.id) } label: {
            VStack(spacing: 5) {
                DonutChart(slices: week.slices, compact: true)
                    .frame(width: 34, height: 34)
                    // The chart's own hover handling was eating the click before
                    // this button ever saw it.
                    .allowsHitTesting(false)
                    .opacity(week.totalMinutes == 0 ? 0.35 : 1)
                Text(week.label)
                    .font(.system(size: 10, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? .primary : .secondary)
                Text(Duration.format(minutes: week.totalMinutes))
                    .font(.system(size: 10))
                    .monospacedDigit()
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(selected ? Color.accentColor.opacity(0.18) : .clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Go to \(week.label)")
    }
}
