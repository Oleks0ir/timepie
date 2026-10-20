import AppKit
import SwiftUI

/// A newer TimePie is out: a small card in the corner, with the way to it and a way to close it.
struct UpdateNotice: View {
    let version: String
    let current: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "arrow.down.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(.tint)
                .symbolRenderingMode(.hierarchical)

            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("TimePie \(version) is out")
                        .font(.callout.weight(.semibold))
                    Text("You have \(current). Download the new one and replace this copy.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button("Open GitHub") { NSWorkspace.shared.open(Updates.releasesPage) }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .help("The latest release, with downloads for Mac and Windows")
            }

            Spacer(minLength: 0)

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 18, height: 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Close. It comes back next time you open TimePie.")
        }
        .padding(12)
        .frame(width: 270)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.quaternary))
        .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
    }
}
