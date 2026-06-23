// Clears stale hidden NSStatusItem visibility entries ControlCenter leaves in
// the app domain. CodexBar #1169: `NSStatusItem VisibleCC … = 0` can block
// compositing even when Menu Bar settings show the app allowed.

import Foundation

enum MenuBarStatusItemDefaultsRepair {
    static let didRepairKey = "hasRepairedHiddenStatusItemVisibilityDefaults"
    private static let visibilityPrefix = "NSStatusItem VisibleCC "

    static func repairHiddenVisibilityDefaultsIfNeeded(defaults: UserDefaults) -> [String] {
        guard !defaults.bool(forKey: didRepairKey) else { return [] }
        let bundle = Bundle.main.bundleIdentifier ?? "dev.cocore.shell"
        let repairedKeys = defaults.dictionaryRepresentation().keys
            .filter { key in
                shouldRepair(key: key, value: defaults.object(forKey: key), bundleId: bundle)
            }
            .sorted()
        for key in repairedKeys {
            defaults.removeObject(forKey: key)
        }
        if !repairedKeys.isEmpty {
            defaults.set(true, forKey: didRepairKey)
        }
        return repairedKeys
    }

    private static func shouldRepair(key: String, value: Any?, bundleId: String) -> Bool {
        guard key.hasPrefix(visibilityPrefix), isFalse(value) else { return false }
        let itemName = String(key.dropFirst(visibilityPrefix.count))
        if itemName.hasPrefix(bundleId) { return true }
        if itemName.hasPrefix("Item-") {
            return itemName.dropFirst("Item-".count).allSatisfy(\.isNumber)
        }
        return false
    }

    private static func isFalse(_ value: Any?) -> Bool {
        switch value {
        case let number as NSNumber: !number.boolValue
        case let bool as Bool: !bool
        default: false
        }
    }
}
