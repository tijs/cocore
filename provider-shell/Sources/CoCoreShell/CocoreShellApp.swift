// CocoreShellApp: AppKit entry for the menu-bar provider shell.
//
// Lifecycle:
//   launch       -> AppDelegate.applicationDidFinishLaunching
//   pair (first) -> kick PairFlow (cocore agent pair), persist session
//   serve        -> AgentSupervisor.start (spawns cocore-provider)
//   quit         -> AgentSupervisor.stop, then NSApp.terminate
//
// We use a plain NSApplication main (not SwiftUI's App + Settings scene).
// On macOS Tahoe, the SwiftUI Settings scene creates infrastructure that
// interferes with NSStatusItem compositing. All UI is AppKit: NSStatusItem
// plus NSHostingController windows.

import AppKit
import ServiceManagement
import SwiftUI

@main
enum CoCoreShellMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let state = AppState()
    let supervisor = AgentSupervisor()
    let updater = Updater()
    private var menu: MenuBarController?
    private var updateTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Tahoe parks NSStatusItems off-screen when created under `.accessory`
        // or LSUIElement. Launch `.regular`, create the tray icon, then hide
        // the Dock via DockActivation once the item is composited on-screen.
        registerLoginItem()
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        menu = MenuBarController(state: state, supervisor: supervisor, updater: updater)
        Task { await updater.check() }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 6 * 60 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in await self?.updater.check() }
        }
        Task { @MainActor in
            await state.refreshSession()
            // Defer onboarding so the status item can settle before we open a
            // SwiftUI window (welcome wizard).
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                self?.menu?.showWelcomeIfNeeded()
            }
            if state.session != nil, !supervisor.isLaunchAgentManaged {
                await supervisor.start()
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { menu?.showMainWindow() }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        supervisor.stopSynchronously()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    private func registerLoginItem() {
        do {
            if SMAppService.mainApp.status != .enabled {
                try SMAppService.mainApp.register()
            }
        } catch {
            NSLog("cocore: login-item registration failed: %@", String(describing: error))
        }
    }
}

@MainActor
final class AppState: ObservableObject {
    @Published var session: PersistedSession?
    @Published var trustLevel: TrustLevel = .selfAttested
    @Published var attestationExpiresAt: Date?
    @Published var creditsLast24h: Int = 0
    @Published var balanceCredits: Int?
    @Published var agentVersion: String?
    @Published var serving: Bool = false
    @Published var lastError: String?

    private enum CacheKey {
        static let credits24h = "cachedCredits24h"
        static let balance = "cachedBalanceCredits"
        static let agentVersion = "cachedAgentVersion"
    }

    init() {
        let d = UserDefaults.standard
        if let c = d.object(forKey: CacheKey.credits24h) as? Int { creditsLast24h = c }
        if let b = d.object(forKey: CacheKey.balance) as? Int { balanceCredits = b }
        if let v = d.string(forKey: CacheKey.agentVersion) { agentVersion = v }
    }

    func refreshSession() async {
        self.session = SessionStore.load()
    }

    func setError(_ msg: String) {
        self.lastError = msg
    }

    private struct StatusResponse: Decodable {
        let earned24h: Int?
        let balance: Int?
        let trustLevel: String?
        let agentVersion: String?
    }

    func refreshStatus() async {
        // `/api/agent/*` are console routes, so target Endpoints.consoleURL —
        // NOT session.apiBase, which is the AppView origin (see Endpoints.swift)
        // and 404s here. Trusting apiBase made every stale-session provider's
        // status poll silently 404 against the AppView.
        guard let s = session,
              let apiKey = s.apiKey,
              let url = URL(string: "\(Endpoints.consoleURL)/api/agent/status")
        else { return }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 10
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return }
            let e = try JSONDecoder().decode(StatusResponse.self, from: data)
            let d = UserDefaults.standard
            if let earned = e.earned24h {
                self.creditsLast24h = earned
                d.set(earned, forKey: CacheKey.credits24h)
            }
            self.balanceCredits = e.balance
            if let bal = e.balance { d.set(bal, forKey: CacheKey.balance) }
            if let raw = e.trustLevel, let t = TrustLevel(rawValue: raw) { self.trustLevel = t }
            if let v = e.agentVersion {
                self.agentVersion = v
                d.set(v, forKey: CacheKey.agentVersion)
            }
        } catch {
            // keep the last good values
        }
    }
}

enum TrustLevel: String { case selfAttested = "self-attested", hardwareAttested = "hardware-attested" }

func creditsDisplay(_ n: Int) -> String {
    let fmt = NumberFormatter()
    fmt.numberStyle = .decimal
    let num = fmt.string(from: NSNumber(value: n)) ?? "\(n)"
    return "\(num) credit\(n == 1 ? "" : "s")"
}
