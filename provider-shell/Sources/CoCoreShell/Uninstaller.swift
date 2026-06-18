// Uninstaller: deregister + remove cocore from this machine, invoked
// from the menu bar's "Uninstall cocore…" (behind a confirm dialog).
//
// Delegates the local wipe + PDS deregistration to the same hosted
// uninstaller the docs use (`/agent/uninstall`), run with COCORE_UNPAIR=1
// so it also deletes this machine's provider record from the user's PDS.
// Then we move the GUI .app to the Trash (the hosted script wipes the
// agent, not this bundle) and the caller quits.

import AppKit
import Foundation

enum Uninstaller {
    /// Run `curl -fsSL <console>/agent/uninstall | COCORE_UNPAIR=1 sh`
    /// and wait for it to finish. Output is logged via NSLog.
    static func run(console: String) async {
        let cmd = "curl -fsSL \(shellQuote(console))/agent/uninstall | COCORE_UNPAIR=1 sh"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", cmd]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { h in
            if let s = String(data: h.availableData, encoding: .utf8), !s.isEmpty {
                NSLog("cocore uninstall: %@", s)
            }
        }
        do {
            try p.run()
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                p.terminationHandler = { _ in
                    pipe.fileHandleForReading.readabilityHandler = nil
                    cont.resume()
                }
            }
        } catch {
            NSLog("cocore: uninstaller failed to launch: %@", String(describing: error))
        }
    }

    /// Move the running .app bundle to the Trash. No-op under `swift run`
    /// (not a .app), so dev runs don't try to trash the build dir.
    static func trashSelf() {
        let bundleURL = Bundle.main.bundleURL
        guard bundleURL.pathExtension == "app" else { return }
        try? FileManager.default.trashItem(at: bundleURL, resultingItemURL: nil)
    }

    private static func shellQuote(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
