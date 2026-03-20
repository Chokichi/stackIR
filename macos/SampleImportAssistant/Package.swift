// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SampleImportAssistant",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "SampleImportAssistant", targets: ["SampleImportAssistant"])
    ],
    targets: [
        .executableTarget(
            name: "SampleImportAssistant",
            path: "Sources"
        )
    ]
)
