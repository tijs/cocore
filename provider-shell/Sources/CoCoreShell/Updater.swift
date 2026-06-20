// Updater: pull-based auto-update for the menu-bar app.
//
// Checks the console's /agent/policy on launch + daily, compares the
// running app's version to `latest` / `minSupported`, and self-updates by
// downloading the NOTARIZED cocore.app.zip from /agent/app, verifying it
// (Gatekeeper-accepted Developer ID — never swap in unverified code),
// then swapping /Applications/cocore.app and relaunching.
//
// Pull-only by design: the only thing we ever run is a notarized release
// we published. `minSupported` is the remote "force update" lever — when
// the running version is below it, the update is applied automatically.

import AppKit
import Foundation

@MainActor
final class Updater: ObservableObject {
    enum Status: Equatable {
        case upToDate
        case available(String)   // newer version available (optional)
        case required(String)    // below minSupported — must update
        case updating(String)    // applying
        case failed(String)
    }

    @Published var status: Status = .upToDate
    @Published var notice: String?

    private struct Policy: Decodable {
        let latest: String
        let minSupported: String
        let notice: String?
    }

    /// CFBundleShortVersionString of the running app, e.g. "0.7.1".
    static var currentVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0.0.0"
    }

    private var consoleBase: String {
        Endpoints.consoleURL
    }

    /// Fetch the policy and update status. If we're below minSupported,
    /// auto-apply immediately (the forced path).
    func check(autoApplyRequired: Bool = true) async {
        guard let url = URL(string: "\(consoleBase)/agent/policy") else { return }
        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let policy = try? JSONDecoder().decode(Policy.self, from: data)
        else { return }

        notice = policy.notice
        let cur = Self.currentVersion
        let latest = policy.latest
        let below = !policy.minSupported.isEmpty
            && Self.compare(cur, policy.minSupported) < 0

        if below {
            status = .required(latest.isEmpty ? "required" : latest)
            if autoApplyRequired { await apply() }
        } else if !latest.isEmpty, Self.compare(cur, Self.normalize(latest)) < 0 {
            status = .available(latest)
        } else {
            status = .upToDate
        }
    }

    /// Download the notarized release, verify it, swap, relaunch.
    func apply() async {
        let version: String
        switch status {
        case .available(let v), .required(let v): version = v
        default: version = "latest"
        }
        status = .updating(version)
        do {
            try await Self.downloadVerifySwapRelaunch(consoleBase: consoleBase)
            // We relaunch + terminate inside; if we get here the helper is
            // detached and we're about to quit.
            NSApp.terminate(nil)
        } catch {
            status = .failed("Update failed: \(error.localizedDescription)")
        }
    }

    // MARK: - version compare (semver-ish, leading "v" tolerated)

    static func normalize(_ v: String) -> String {
        v.hasPrefix("v") ? String(v.dropFirst()) : v
    }

    /// -1 / 0 / 1 comparing dotted numeric versions (e.g. 0.7.1 vs 0.7.0).
    static func compare(_ a: String, _ b: String) -> Int {
        let pa = normalize(a).split(separator: ".").map { Int($0) ?? 0 }
        let pb = normalize(b).split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0
            let y = i < pb.count ? pb[i] : 0
            if x != y { return x < y ? -1 : 1 }
        }
        return 0
    }

    // MARK: - download + verify + swap

    private enum UpdateError: LocalizedError {
        case download(Int), unzip, notSigned, notNotarized, swapScript
        var errorDescription: String? {
            switch self {
            case .download(let c): return "download failed (HTTP \(c))"
            case .unzip: return "could not unzip the update"
            case .notSigned: return "the update isn't validly signed — refusing"
            case .notNotarized: return "the update isn't notarized — refusing"
            case .swapScript: return "could not launch the install helper"
            }
        }
    }

    private static func downloadVerifySwapRelaunch(consoleBase: String) async throws {
        let fm = FileManager.default
        let tmp = fm.temporaryDirectory.appendingPathComponent("cocore-update-\(ProcessInfo.processInfo.globallyUniqueString)")
        try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
        let zip = tmp.appendingPathComponent("cocore.app.zip")

        // 1. download the notarized zip
        guard let url = URL(string: "\(consoleBase)/agent/app") else { throw UpdateError.download(0) }
        let (file, resp) = try await URLSession.shared.download(from: url)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            throw UpdateError.download((resp as? HTTPURLResponse)?.statusCode ?? 0)
        }
        try? fm.removeItem(at: zip)
        try fm.moveItem(at: file, to: zip)

        // 2. unzip
        guard run("/usr/bin/ditto", ["-x", "-k", zip.path, tmp.path]) == 0 else { throw UpdateError.unzip }
        let newApp = tmp.appendingPathComponent("cocore.app")
        guard fm.fileExists(atPath: newApp.path) else { throw UpdateError.unzip }

        // 3. verify — only ever swap in a validly-signed, NOTARIZED bundle
        guard run("/usr/bin/codesign", ["--verify", "--strict", newApp.path]) == 0 else { throw UpdateError.notSigned }
        guard run("/usr/sbin/spctl", ["-a", "-t", "exec", newApp.path]) == 0 else { throw UpdateError.notNotarized }

        // 4. detached helper: wait for us to quit, swap, relaunch
        let dest = "/Applications/cocore.app"
        let pid = ProcessInfo.processInfo.processIdentifier
        let helper = tmp.appendingPathComponent("swap.sh")
        let script = """
        #!/bin/sh
        # wait for the running app (pid \(pid)) to exit
        while kill -0 \(pid) 2>/dev/null; do sleep 0.3; done
        rm -rf "\(dest)"
        cp -R "\(newApp.path)" "\(dest)"
        xattr -dr com.apple.quarantine "\(dest)" 2>/dev/null
        open "\(dest)"
        rm -rf "\(tmp.path)"
        """
        try script.write(to: helper, atomically: true, encoding: .utf8)
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = [helper.path]
        do { try p.run() } catch { throw UpdateError.swapScript }
    }

    @discardableResult
    private static func run(_ tool: String, _ args: [String]) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = args
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run(); p.waitUntilExit(); return p.terminationStatus } catch { return -1 }
    }
}
