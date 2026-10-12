// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TimePie",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "TimePie",
            path: "Sources/TimePie",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
