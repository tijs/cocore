// MainTabView: the single window the tray opens, folding what used to be
// the separate Status / Models / Preferences windows plus the Help/About
// actions (bug report, updates, version, uninstall) into one tabbed window.
// That lets the status-bar menu stay short — it keeps only the serving
// toggle, the at-a-glance lines, contextual alerts, "Open cocore…", and
// Quit. Action closures route back to MenuBarController, which owns the
// NSAlert flows and the supervisor lifecycle.

import AppKit
import SwiftUI

struct MainTabView: View {
    @ObservedObject var state: AppState
    let supervisor: AgentSupervisor
    @ObservedObject var updater: Updater
    @ObservedObject var modelManager: ModelManager

    let onOpenProfile: () -> Void
    let onOpenSetupGuide: () -> Void
    let onSignOut: () -> Void
    let onSendBugReport: () -> Void
    let onCheckUpdates: () -> Void
    let onInstallUpdate: () -> Void
    let onUninstall: () -> Void

    var body: some View {
        TabView {
            StatusTab(
                updater: updater,
                onOpenProfile: onOpenProfile,
                onOpenSetupGuide: onOpenSetupGuide,
                onSignOut: onSignOut,
                onCheckUpdates: onCheckUpdates,
                onInstallUpdate: onInstallUpdate
            )
            .tabItem { Label("Status", systemImage: "waveform.path.ecg") }

            ModelsView(manager: modelManager)
                .tabItem { Label("Models", systemImage: "cpu") }

            PreferencesView(supervisor: supervisor)
                .tabItem { Label("Preferences", systemImage: "gearshape") }

            HelpTab(
                updater: updater,
                onSendBugReport: onSendBugReport,
                onCheckUpdates: onCheckUpdates,
                onInstallUpdate: onInstallUpdate,
                onUninstall: onUninstall
            )
            .tabItem { Label("Help", systemImage: "questionmark.circle") }
        }
        .environmentObject(state)
        .frame(width: 520, height: 600)
        .brandStyled()
    }
}

/// Identity + serving + credits + versions (the shared `StatusRows`), with
/// the account actions that used to be their own menu items. The update
/// control sits right under the version rows so "Check for updates…" is on
/// the first page, not buried in Help.
private struct StatusTab: View {
    @ObservedObject var updater: Updater
    let onOpenProfile: () -> Void
    let onOpenSetupGuide: () -> Void
    let onSignOut: () -> Void
    let onCheckUpdates: () -> Void
    let onInstallUpdate: () -> Void
    @EnvironmentObject private var state: AppState

    var body: some View {
        Form {
            StatusRows()
            Section("Updates") {
                UpdateControl(
                    updater: updater,
                    onCheckUpdates: onCheckUpdates,
                    onInstallUpdate: onInstallUpdate
                )
            }
            Section {
                Button("View my profile on console", action: onOpenProfile)
                    .disabled(state.session == nil)
                Button("Setup guide…", action: onOpenSetupGuide)
                Button("Sign out", action: onSignOut)
                    .disabled(state.session == nil)
            }
        }
        .formStyle(.grouped)
    }
}

/// The update affordance, shared by the Status tab and the Help tab so both
/// surfaces show the same state-appropriate control (check / update / retry).
private struct UpdateControl: View {
    @ObservedObject var updater: Updater
    let onCheckUpdates: () -> Void
    let onInstallUpdate: () -> Void

    var body: some View {
        switch updater.status {
        case .upToDate:
            Button("Check for updates…", action: onCheckUpdates)
        case .available(let v):
            Button("Update to \(v)…", action: onInstallUpdate)
        case .required(let v):
            Text("Update required (\(v)) — installing…").foregroundStyle(.secondary)
        case .updating(let v):
            Text("Updating to \(v)…").foregroundStyle(.secondary)
        case .failed(let m):
            LabeledContent("Update", value: m)
            Button("Retry update", action: onInstallUpdate)
        }
    }
}

/// Software/version, the update control, the bug-report action, and the
/// uninstall — the housekeeping that doesn't belong in the tray menu.
private struct HelpTab: View {
    @ObservedObject var updater: Updater
    let onSendBugReport: () -> Void
    let onCheckUpdates: () -> Void
    let onInstallUpdate: () -> Void
    let onUninstall: () -> Void

    var body: some View {
        Form {
            Section("Software") {
                LabeledContent("Version", value: Updater.currentVersion)
                UpdateControl(
                    updater: updater,
                    onCheckUpdates: onCheckUpdates,
                    onInstallUpdate: onInstallUpdate
                )
            }
            if let n = updater.notice, !n.isEmpty {
                Section { Text(n).foregroundStyle(.secondary) }
            }
            Section("Something wrong?") {
                Button("Send bug report…", action: onSendBugReport)
                Text("Sends crash + health telemetry only — no prompts, no API key, no signing key.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section {
                Button("Uninstall cocore…", role: .destructive, action: onUninstall)
            }
        }
        .formStyle(.grouped)
    }
}

/// Hosts MainTabView in the single window the tray's "Open cocore…" opens.
@MainActor
final class MainWindowController {
    private var window: NSWindow?
    private let rootView: MainTabView

    init(rootView: MainTabView) { self.rootView = rootView }

    func show() {
        if window == nil {
            let hosting = NSHostingController(rootView: rootView)
            let w = NSWindow(contentViewController: hosting)
            w.title = "cocore"
            w.styleMask = [.titled, .closable, .miniaturizable]
            w.isReleasedWhenClosed = false
            w.center()
            window = w
        }
        if let w = window { WindowActivation.present(w) }
    }
}
