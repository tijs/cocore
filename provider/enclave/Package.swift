// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CoCoreEnclave",
    platforms: [.macOS(.v13)],
    products: [
        // Static library; the Rust provider agent links against it via
        // build.rs (M5) or you can drop the .a into provider/lib/ today.
        .library(
            name: "CoCoreEnclave",
            type: .static,
            targets: ["CoCoreEnclave"]
        ),
    ],
    targets: [
        .target(
            name: "CoCoreEnclave",
            path: "Sources/CoCoreEnclave",
            publicHeadersPath: "include"
        ),
        .testTarget(
            name: "CoCoreEnclaveTests",
            dependencies: ["CoCoreEnclave"],
            path: "Tests/CoCoreEnclaveTests"
        ),
    ]
)
