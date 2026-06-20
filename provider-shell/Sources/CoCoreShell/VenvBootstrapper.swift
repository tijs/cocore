// VenvBootstrapper: sets up the uv-managed Python runtime
// (~/.cocore/python with vllm-mlx) that the agent's subprocess engine
// needs to serve real models. On a download-only install the headless
// installer never ran, so the app bootstraps it on demand — when the
// user enables a real (non-stub) model — streaming progress into the UI.
//
// Runs the same scripts/bootstrap-python-venv.sh the curl|sh installer
// uses, bundled into the app at Contents/Resources/scripts/. Idempotent.

import Foundation

@MainActor
final class VenvBootstrapper: ObservableObject {
    enum State: Equatable {
        case idle
        case running(String)   // latest progress line
        case done
        case failed(String)
    }

    @Published var state: State = .idle

    var isRunning: Bool { if case .running = state { return true } else { return false } }

    /// True once the Python runtime the agent spawns is present.
    static var isInstalled: Bool {
        FileManager.default.isExecutableFile(
            atPath: NSHomeDirectory() + "/.cocore/python/bin/python")
    }

    /// Run the bundled bootstrap script, streaming its phase lines into
    /// `state`. ~30MB Python + ~250MB deps on first run; idempotent after.
    func bootstrap() async {
        guard !isRunning else { return }
        guard let script = Self.bundledScript() else {
            state = .failed("Setup script missing from the app bundle.")
            return
        }
        state = .running("Starting…")
        let venv = NSHomeDirectory() + "/.cocore/python"
        let exit: Int32 = await withCheckedContinuation { cont in
            DispatchQueue.global().async { [weak self] in
                let p = Process()
                p.executableURL = URL(fileURLWithPath: "/bin/sh")
                p.arguments = [script]
                var env = ProcessInfo.processInfo.environment
                env["HOME"] = NSHomeDirectory()
                env["COCORE_PYTHON_VENV"] = venv
                p.environment = env
                let pipe = Pipe()
                p.standardOutput = pipe
                p.standardError = pipe
                pipe.fileHandleForReading.readabilityHandler = { [weak self] h in
                    guard let chunk = String(data: h.availableData, encoding: .utf8) else { return }
                    NSLog("cocore venv: %@", chunk)
                    let latest = chunk
                        .split(whereSeparator: \.isNewline)
                        .map { $0.trimmingCharacters(in: .whitespaces) }
                        .last(where: { !$0.isEmpty })
                    guard let latest else { return }
                    let clean = latest.replacingOccurrences(of: "==> ", with: "")
                    Task { @MainActor [weak self] in
                        if case .running = self?.state { self?.state = .running(clean) }
                    }
                }
                do {
                    try p.run()
                    p.waitUntilExit()
                    pipe.fileHandleForReading.readabilityHandler = nil
                    cont.resume(returning: p.terminationStatus)
                } catch {
                    cont.resume(returning: -1)
                }
            }
        }
        state = exit == 0 ? .done : .failed("Setup failed (exit \(exit)). See Console.app logs.")
    }

    private static func bundledScript() -> String? {
        let path = Bundle.main.bundleURL
            .appendingPathComponent("Contents/Resources/scripts/bootstrap-python-venv.sh").path
        return FileManager.default.fileExists(atPath: path) ? path : nil
    }
}
