import Foundation
import Observation

/// Whether a newer TimePie is out. The app doesn't update itself — friends download each
/// release from GitHub — so this is how they hear about one: the latest release's tag,
/// compared with this build's version.
@MainActor
@Observable
final class Updates {
    static let releasesPage = URL(string: "https://github.com/kravchenkonikolai05/timepie/releases/latest")!
    private static let latestRelease = URL(string: "https://api.github.com/repos/kravchenkonikolai05/timepie/releases/latest")!
    private static let checkEvery: Swift.Duration = .seconds(6 * 60 * 60)

    /// This build's version. Nil for one run straight from `swift build`, which has none,
    /// so it never asks. TIMEPIE_VERSION stands in for one, for a test run.
    let current: String? = ProcessInfo.processInfo.environment["TIMEPIE_VERSION"]
        ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    /// A newer version than this one, once GitHub has said so.
    private(set) var available: String?
    /// Closed for now. It's back next launch, until you've updated.
    var dismissed = false

    /// Checks now and every few hours, for as long as the caller's task runs.
    func watch() async {
        guard current != nil else { return }
        while !Task.isCancelled {
            await check()
            try? await Task.sleep(for: Updates.checkEvery)
        }
    }

    /// Quietly gives up on any failure: offline, or GitHub's rate limit, is no reason to bother you.
    private func check() async {
        var req = URLRequest(url: Updates.latestRelease)
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 15
        guard let current,
              let (data, _) = try? await URLSession.shared.data(for: req),
              let release = try? JSONDecoder().decode(Release.self, from: data) else { return }
        let latest = release.tagName.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
        if Updates.isNewer(latest, than: current) { available = latest }
    }

    /// "1.10.0" is newer than "1.9.2": compared number by number, not as text.
    nonisolated static func isNewer(_ a: String, than b: String) -> Bool {
        let parts = { (s: String) in s.split(separator: ".").map { Int($0) ?? 0 } }
        let x = parts(a), y = parts(b)
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
            if l != r { return l > r }
        }
        return false
    }

    private struct Release: Decodable {
        let tagName: String
        enum CodingKeys: String, CodingKey { case tagName = "tag_name" }
    }
}
