// PairFlow: pair this machine with an ATProto identity using the
// console's device-pair flow — the same path the `cocore agent pair`
// CLI uses, and the only one the deployed console actually serves.
//
// The earlier embedded-OAuth design (an ASWebAuthenticationSession
// against a console `/oauth/start` redirector) was never finished:
// no `/oauth/*` route exists on the console, so it 404'd ("Not
// Found"). Rather than reimplement the full PAR+PKCE+DPoP dance in
// Swift, the menu-bar app delegates to the installed `cocore` binary,
// which performs devicePair.start → (user approves in browser) →
// devicePair.poll and persists the session at ~/.cocore/session.json.
// We open the approval URL it prints and wait for it to finish.

import AppKit
import Foundation

/// The session blob the `cocore` agent persists at
/// ~/.cocore/session.json. Its shape is owned by the Rust agent's
/// device-pair flow; the app only *reads* it — for identity display and
/// to know whether this machine is paired.
struct PersistedSession: Codable {
    let did: String
    let handle: String
    let apiKey: String?
    let apiBase: String?
}

enum PairError: Error {
    case binaryNotFound
    case pairFailed(Int32)
    case noSession
}

/// The approval URL + short code the device-pair flow prints. Surfaced to
/// the UI so the user always has a reliable path even if the auto-open of
/// their browser doesn't land (e.g. the browser opens behind our window).
struct PairPrompt: Equatable {
    let url: URL
    let code: String
}

enum PairFlow {
    /// Run the device-pair flow and return the persisted session. `onPrompt`
    /// fires (on the main queue) as soon as the approval URL + code are
    /// known, so the caller can display them; we ALSO try to open the URL
    /// in the browser automatically as a convenience.
    static func signIn(onPrompt: ((PairPrompt) -> Void)? = nil) async throws -> PersistedSession {
        guard let bin = AgentSupervisor.locateBinary() else {
            throw PairError.binaryNotFound
        }
        let console = Endpoints.consoleURL

        let status = try await runPair(bin: bin, console: console, onPrompt: onPrompt)
        guard status == 0 else { throw PairError.pairFailed(status) }
        guard let session = SessionStore.load() else { throw PairError.noSession }
        return session
    }

    /// Spawn `cocore agent pair`, surface (and auto-open) the approval URL
    /// it prints to its stdout, and wait for it to exit. Returns the
    /// process exit status.
    private static func runPair(
        bin: URL, console: String, onPrompt: ((PairPrompt) -> Void)?
    ) async throws -> Int32 {
        let p = Process()
        p.executableURL = bin
        p.arguments = ["agent", "pair", "--console", console]

        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        // Accumulate output across reads (the URL could in principle be
        // split across chunks) and fire once, the first time we can parse a
        // prompt out of everything seen so far.
        let accumulated = OutputBuffer()
        pipe.fileHandleForReading.readabilityHandler = { h in
            let data = h.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            NSLog("cocore pair: %@", text)
            guard let prompt = accumulated.appendAndParse(text) else { return }
            DispatchQueue.main.async {
                // Convenience auto-open; the UI shows the same URL + code as
                // a clickable fallback in case this opens behind our window
                // or the default browser handler misbehaves.
                NSWorkspace.shared.open(prompt.url)
                onPrompt?(prompt)
            }
        }

        try p.run()
        return await withCheckedContinuation { (cont: CheckedContinuation<Int32, Never>) in
            p.terminationHandler = { proc in
                pipe.fileHandleForReading.readabilityHandler = nil
                cont.resume(returning: proc.terminationStatus)
            }
        }
    }

    /// Pull the first `…/devices/new?code=…` URL out of the CLI's output.
    static func firstApprovalURL(in text: String) -> URL? {
        for token in text.split(whereSeparator: { " \n\r\t".contains($0) }) {
            let s = token.trimmingCharacters(in: CharacterSet(charactersIn: "\"'<>()[]"))
            if s.contains("/devices/new"), let url = URL(string: s) {
                return url
            }
        }
        return nil
    }

    /// Parse the approval URL + its `code` query item into a `PairPrompt`.
    static func parsePrompt(in text: String) -> PairPrompt? {
        guard let url = firstApprovalURL(in: text) else { return nil }
        let code = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "code" })?.value ?? ""
        return PairPrompt(url: url, code: code)
    }
}

/// Tiny thread-safe accumulator for the pair CLI's piped output. The
/// readabilityHandler runs on a private queue and may fire multiple times;
/// this coalesces chunks and yields the prompt exactly once.
private final class OutputBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var text = ""
    private var fired = false

    func appendAndParse(_ chunk: String) -> PairPrompt? {
        lock.lock(); defer { lock.unlock() }
        if fired { return nil }
        text += chunk
        guard let prompt = PairFlow.parsePrompt(in: text) else { return nil }
        fired = true
        return prompt
    }
}

// MARK: - Session storage

enum SessionStore {
    /// The agent's session blob. The Rust agent (via `cocore agent
    /// pair`) owns writes; the app only reads it and, on sign-out,
    /// removes it. This is the SAME file the headless agent and the
    /// LaunchAgent use, so the menu reflects the real paired identity.
    static var fileURL: URL {
        URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent(".cocore/session.json")
    }

    static func load() -> PersistedSession? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(PersistedSession.self, from: data)
    }

    static func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
