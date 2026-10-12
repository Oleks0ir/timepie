import SwiftUI

struct Slice: Identifiable, Equatable {
    let id: UUID
    let name: String
    let minutes: Int
    let colorSlot: Int
}

/// Part-to-whole at a glance. 100% is the time you logged, not the whole week.
///
/// Each slice is a stroked arc rather than a filled wedge, and slices meet flush with
/// no separating gap — this palette's adjacent pairs validate at CVD ΔE 9.1 (light) and
/// 8.4 (dark), both clear of the ≥8 target, so hue alone carries the separation.
struct DonutChart: View {
    let slices: [Slice]
    var hoveredID: UUID?
    var compact: Bool = false
    var onHover: ((UUID?) -> Void)?

    private var total: Int { slices.reduce(0) { $0 + max(0, $1.minutes) } }

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            // The ring eats half the dead space between the hours figure and the
            // inner edge: the hole was 0.28·side and the figure occupies ~0.16·side.
            let ringWidth = compact ? side * 0.30 : side * 0.28
            let outerR = side / 2
            let midR = outerR - ringWidth / 2
            let innerR = outerR - ringWidth
            let centre = CGPoint(x: geo.size.width / 2, y: geo.size.height / 2)

            ZStack {
                if total == 0 {
                    // Empty skeleton: the circle holding its shape, waiting.
                    Circle()
                        .strokeBorder(Ink.muted.opacity(0.35), lineWidth: 1)
                        .frame(width: side - ringWidth, height: side - ringWidth)
                } else {
                    ForEach(arcs(), id: \.slice.id) { arc in
                        ArcShape(start: arc.start, end: arc.end)
                            .stroke(
                                Palette.color(slot: arc.slice.colorSlot),
                                style: StrokeStyle(
                                    lineWidth: hoveredID == arc.slice.id ? ringWidth + 6 : ringWidth,
                                    lineCap: .butt
                                )
                            )
                            .frame(width: midR * 2, height: midR * 2)
                    }
                }

                if !compact {
                    centerFigure
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            // Which wedge the pointer is over is computed from its angle and radius.
            // Letting overlapping shapes in a ZStack decide meant a later slice could
            // capture the pointer and highlight the wrong activity entirely.
            .onContinuousHover { phase in
                guard !compact, let notify = onHover else { return }
                switch phase {
                case .active(let point):
                    notify(sliceID(at: point, centre: centre, innerR: innerR, outerR: outerR))
                case .ended:
                    notify(nil)
                @unknown default:
                    notify(nil)
                }
            }
            .animation(.easeInOut(duration: 0.35), value: slices)
            .animation(.easeOut(duration: 0.12), value: hoveredID)
        }
        .aspectRatio(1, contentMode: .fit)
    }

    /// The one number the app leads with. Proportional figures — tabular would make
    /// a value like "12h" look loose at this size.
    private var centerFigure: some View {
        Text(Duration.format(minutes: total))
            .font(.system(size: 34, weight: .semibold))
            .foregroundStyle(total == 0 ? Ink.muted : Ink.primary)
            .contentTransition(.numericText())
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .padding(.horizontal, 8)
    }

    // MARK: - Geometry

    private struct Arc {
        let slice: Slice
        let start: Double
        let end: Double
    }

    /// Angles in radians, starting at 12 o'clock and running clockwise.
    private func arcs() -> [Arc] {
        guard total > 0 else { return [] }
        var cursor = -Double.pi / 2
        var result: [Arc] = []
        for slice in slices where slice.minutes > 0 {
            let sweep = (Double(slice.minutes) / Double(total)) * 2 * Double.pi
            result.append(Arc(slice: slice, start: cursor, end: cursor + sweep))
            cursor += sweep
        }
        return result
    }

    private func sliceID(at point: CGPoint, centre: CGPoint,
                         innerR: CGFloat, outerR: CGFloat) -> UUID? {
        guard total > 0 else { return nil }

        let dx = point.x - centre.x
        let dy = point.y - centre.y
        let radius = sqrt(dx * dx + dy * dy)
        // Ignore the hole and anything outside the ring.
        guard radius >= innerR, radius <= outerR else { return nil }

        // Screen y grows downward, so atan2 gives -π/2 at 12 o'clock; shifting by π/2
        // puts 0 there and makes the angle grow clockwise, matching arcs().
        var angle = atan2(dy, dx) + Double.pi / 2
        if angle < 0 { angle += 2 * Double.pi }

        var cursor = 0.0
        for slice in slices where slice.minutes > 0 {
            let sweep = (Double(slice.minutes) / Double(total)) * 2 * Double.pi
            if angle >= cursor && angle < cursor + sweep { return slice.id }
            cursor += sweep
        }
        return nil
    }
}

/// `animatableData` is what lets a wedge grow smoothly when time is added, rather
/// than snapping to its new size.
private struct ArcShape: Shape {
    var start: Double
    var end: Double

    var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(start, end) }
        set {
            start = newValue.first
            end = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.addArc(center: CGPoint(x: rect.midX, y: rect.midY),
                 radius: rect.width / 2,
                 startAngle: .radians(start),
                 endAngle: .radians(end),
                 clockwise: false)
        return p
    }
}

// Outside labels were removed deliberately: the activity rows below the chart are
// both the legend and the table view, so every name, value and percentage is already
// readable there — and the ring stays a clean object with nothing crowding it.
