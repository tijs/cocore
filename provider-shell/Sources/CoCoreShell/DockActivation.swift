// DockActivation: hide the Dock on Tahoe without breaking the tray icon.
//
// Tahoe parks NSStatusItems off-screen when they are created under
// LSUIElement or `.accessory`. The fix: launch as `.regular`, create the
// status item, wait until it is composited on-screen, then flip to
// `.accessory`. Re-verify after the flip; if the tray vanishes, stay
// `.regular` (Dock visible) rather than lose the menu bar entry point.
//
// While a tray window is open we promote back to `.regular` so Cmd-Tab and
// the Dock icon offer a way back if the user switches away.

import AppKit

@MainActor
enum DockActivation {
    /// Registered by MenuBarController — returns true when the tray icon is
    /// composited in the menu bar (not the Tahoe off-screen proxy slot).
    static var isTrayComposited: (() -> Bool)?

    private static var dockHidden = false

    /// Call once the status item is on-screen. Safe to call repeatedly.
    static func hideDockWhenTrayReady() {
        guard isTrayComposited?() == true else { return }
        guard NSApp.activationPolicy() != .accessory else {
            dockHidden = true
            return
        }
        NSApp.setActivationPolicy(.accessory)
        // ControlCenter sometimes re-parks the item when policy flips — check
        // shortly after rather than assuming the switch succeeded.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            if isTrayComposited?() == true {
                dockHidden = true
            } else {
                NSLog("cocore: tray lost after accessory switch; keeping Dock visible")
                if NSApp.activationPolicy() != .regular {
                    NSApp.setActivationPolicy(.regular)
                }
                dockHidden = false
            }
        }
    }

    /// Tray windows need Cmd-Tab / Dock while open.
    static func showDockForWindow() {
        dockHidden = false
        if NSApp.activationPolicy() != .regular {
            NSApp.setActivationPolicy(.regular)
        }
    }

    /// After the last tray window closes, hide the Dock again if the tray
    /// icon is still composited.
    static func hideDockAfterLastWindowClosed() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
            hideDockWhenTrayReady()
        }
    }
}
