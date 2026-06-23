// Endpoints: the console + advisor URLs the app talks to, resolved with a
// three-layer fallback so one build can target prod, dev, or a per-PR stack.
//
//   1. User override — what the owner typed in Settings → Network
//      (UserDefaults "consoleBaseUrl" / "advisorUrl"). Always wins.
//   2. Build-time baked default — Info.plist "CocoreConsoleURL" /
//      "CocoreAdvisorURL", stamped by scripts/build-mac-app.sh from the
//      COCORE_CONSOLE_URL / COCORE_ADVISOR_URL env at build time. This is how
//      a PR-built app defaults to that PR's stack and a dev build to dev.
//   3. Hardcoded prod — when neither of the above is present (a plain
//      release build), the app behaves exactly as before.
//
// Only console + advisor are needed: the AppView origin the agent writes to
// comes from the device-pair session's `apiBase`, which the paired console
// already points at the right AppView. Reads are plain UserDefaults/Bundle
// lookups, safe from any actor (used from nonisolated contexts too).

import Foundation

enum Endpoints {
    static let prodConsole = "https://cocore.dev"
    static let prodAdvisor = "wss://advisor.cocore.dev/v1/agent"

    /// Build-time default written into Info.plist, else prod. This is the
    /// value Settings → Network shows as its starting point.
    static var bakedConsole: String { infoPlist("CocoreConsoleURL") ?? prodConsole }
    static var bakedAdvisor: String { infoPlist("CocoreAdvisorURL") ?? prodAdvisor }

    /// The effective URLs the agent + UI should use: owner override wins,
    /// otherwise the build-time baked default.
    static var consoleURL: String { userOverride("consoleBaseUrl") ?? bakedConsole }
    static var advisorURL: String { userOverride("advisorUrl") ?? bakedAdvisor }

    private static func userOverride(_ key: String) -> String? {
        nonEmpty(UserDefaults.standard.string(forKey: key))
    }

    private static func infoPlist(_ key: String) -> String? {
        nonEmpty(Bundle.main.object(forInfoDictionaryKey: key) as? String)
    }

    private static func nonEmpty(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else {
            return nil
        }
        return t
    }
}
