// WindowActivation: keeps the menu-bar app findable while it has a window
// on screen.
//
// The app normally runs as `.accessory` — no Dock icon, and INVISIBLE to
// Cmd-Tab. That's right when only the status-bar menu is showing, but the
// moment we open a real window (Welcome, Models, Preferences) the user can
// switch away and then have no way back: Cmd-Tab skips us and there's no
// Dock icon to click.
//
// So: while ANY tray window is open we promote to `.regular` (Dock icon +
// Cmd-Tab entry), and we demote back to `.accessory` once the last one
// closes. Every window controller routes its `show()` through
// `present(_:)` instead of calling `makeKeyAndOrderFront` directly.

import AppKit

@MainActor
enum WindowActivation {
    /// Identities of the tray windows currently open.
    private static var open: Set<ObjectIdentifier> = []
    /// willClose observers, keyed by window identity so we can detach them.
    private static var observers: [ObjectIdentifier: NSObjectProtocol] = [:]

    /// Bring `window` to the front and make the app Cmd-Tab-able for as
    /// long as it (or any other tray window) stays open. Idempotent — safe
    /// to call again on an already-tracked window when it's re-shown.
    static func present(_ window: NSWindow) {
        let id = ObjectIdentifier(window)
        if open.insert(id).inserted {
            observers[id] = NotificationCenter.default.addObserver(
                forName: NSWindow.willCloseNotification, object: window, queue: .main
            ) { _ in
                // willCloseNotification is delivered on the main thread, but
                // hop through the main actor to satisfy isolation checking.
                Task { @MainActor in release(id) }
            }
        }
        if NSApp.activationPolicy() != .regular {
            NSApp.setActivationPolicy(.regular)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private static func release(_ id: ObjectIdentifier) {
        if let obs = observers.removeValue(forKey: id) {
            NotificationCenter.default.removeObserver(obs)
        }
        open.remove(id)
        // Back to menu-bar-only once nothing is on screen.
        if open.isEmpty {
            NSApp.setActivationPolicy(.accessory)
        }
    }
}
