import Foundation
import AppKit
import UniformTypeIdentifiers

/// Your history is never trapped. The store file is already this exact format —
/// export just puts a copy somewhere you chose.
enum Export {
    static func run(store: Store) {
        guard let data = try? Store.encoder().encode(store.payload) else { return }

        let dayFormatter = DateFormatter()
        dayFormatter.dateFormat = "yyyy-MM-dd"

        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.nameFieldStringValue = "timepie-\(dayFormatter.string(from: Date())).json"
        panel.canCreateDirectories = true

        if panel.runModal() == .OK, let url = panel.url {
            try? data.write(to: url, options: .atomic)
        }
    }

    static func revealStoreFile(store: Store) {
        NSWorkspace.shared.activateFileViewerSelecting([store.storeLocation])
    }
}
