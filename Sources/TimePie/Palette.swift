import SwiftUI
import AppKit

/// The validated categorical palette.
///
/// Eight slots, in a fixed order chosen so that *adjacent* slots stay separable under
/// colour-vision deficiency. Verified with the dataviz validator against macOS's real
/// window backgrounds (#ECECEC light, #1E1E1E dark):
///
///   light — worst adjacent CVD ΔE 9.1, normal-vision ΔE 19.6, all bands pass
///   dark  — worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3, all ≥ 3:1 contrast
///
/// Light mode warns that orange/aqua/yellow/magenta sit below 3:1 on the window
/// background. That is discharged by the "relief rule": the activity rows below the
/// chart are a full table view carrying name and exact hours for every slice.
///
/// There is no ninth hue. A generated one is indistinguishable from an existing slot
/// under CVD, so overflow activities take neutral grey and lean on their row.
enum Palette {
    static let lightHexes = [
        "#2a78d6", // 1 blue
        "#eb6834", // 2 orange
        "#1baf7a", // 3 aqua
        "#eda100", // 4 yellow
        "#e87ba4", // 5 magenta
        "#008300", // 6 green
        "#4a3aa7", // 7 violet
        "#e34948", // 8 red
    ]

    static let darkHexes = [
        "#3987e5", "#d95926", "#199e70", "#c98500",
        "#d55181", "#008300", "#9085e9", "#e66767",
    ]

    /// Slot 8+ — deliberately not a hue.
    static let overflowHex = "#898781"

    static var slotCount: Int { lightHexes.count }

    static func color(slot: Int) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            let hexes = isDark ? darkHexes : lightHexes
            let hex = (slot >= 0 && slot < hexes.count) ? hexes[slot] : overflowHex
            return NSColor(hex: hex)
        })
    }

    /// Lowest slot not already taken, else overflow grey.
    static func nextSlot(taken: [Int]) -> Int {
        for slot in 0..<slotCount where !taken.contains(slot) { return slot }
        return slotCount
    }
}

/// Chart chrome. Marks carry colour; text never does.
enum Ink {
    static let primary = Color.primary
    static let secondary = Color.secondary
    static let muted = Color(nsColor: NSColor(hex: "#898781"))
    /// A shade darker than the system window (#ECECEC / #1E1E1E).
    static let background = Color(nsColor: NSColor(name: nil) { appearance in
        let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        return NSColor(hex: isDark ? "#171717" : "#E2E2E2")
    })
}

extension NSColor {
    convenience init(hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        self.init(
            srgbRed: CGFloat((v & 0xFF0000) >> 16) / 255,
            green: CGFloat((v & 0x00FF00) >> 8) / 255,
            blue: CGFloat(v & 0x0000FF) / 255,
            alpha: 1
        )
    }
}
