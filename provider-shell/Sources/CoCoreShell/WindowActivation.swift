// WindowActivation: bring tray windows to the front and coordinate Dock
// visibility with DockActivation (see DockActivation.swift).

import AppKit

@MainActor
enum WindowActivation {
    private static var open: Set<ObjectIdentifier> = []
    private static var observers: [ObjectIdentifier: NSObjectProtocol] = [:]

    static func present(_ window: NSWindow) {
        let id = ObjectIdentifier(window)
        if open.insert(id).inserted {
            observers[id] = NotificationCenter.default.addObserver(
                forName: NSWindow.willCloseNotification, object: window, queue: .main
            ) { _ in
                Task { @MainActor in release(id) }
            }
        }
        DockActivation.showDockForWindow()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private static func release(_ id: ObjectIdentifier) {
        if let obs = observers.removeValue(forKey: id) {
            NotificationCenter.default.removeObserver(obs)
        }
        open.remove(id)
        if open.isEmpty {
            DockActivation.hideDockAfterLastWindowClosed()
        }
    }
}
