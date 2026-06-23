// Brand: the cocore visual identity, shared by every window the tray
// opens so the app matches the console (cocore.dev) instead of
// defaulting to system blue.
//
// Colors are transcribed from the console design system — a Radix
// "bronze" scale (packages/console/src/design-system/theme/colors/
// bronze.stylex.tsx) plus the OG card tokens (src/og/root-og.tokens.ts)
// and the favicon mark fill (#ad7f58). Each token is light/dark aware via
// a dynamic NSColor so the windows read correctly in either appearance.

import AppKit
import SwiftUI

enum Brand {
    private static func srgb(_ hex: UInt32) -> NSColor {
        NSColor(
            srgbRed: Double((hex >> 16) & 0xff) / 255.0,
            green: Double((hex >> 8) & 0xff) / 255.0,
            blue: Double(hex & 0xff) / 255.0,
            alpha: 1.0)
    }

    /// A Color that resolves `light`/`dark` against the current appearance.
    /// `NSColor(name:dynamicProvider:)` works back to macOS 10.15, unlike
    /// SwiftUI's `Color(light:dark:)` which is newer than our 13.0 floor.
    private static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
                ? srgb(dark) : srgb(light)
        })
    }

    /// The brand mark fill (favicon `#ad7f58`); lightened in dark mode so
    /// the notch glyph stays legible on a dark window.
    static let mark = dyn(0xad7f58, 0xcaa07a)

    /// Primary interactive accent — Radix bronze 9 (`#a18072`). Used as the
    /// app `.tint`, so buttons, menus, pickers and progress all pick it up.
    static let accent = dyn(0xa18072, 0xae8c7e)

    /// Bronze text on a surface — Radix bronze 11.
    static let accentText = dyn(0x7d5e54, 0xd4b3a5)

    /// Warm "card" surface for the splash header — Radix bronze 2 / the OG
    /// card token.
    static let surface = dyn(0xfcf9f6, 0x1c1917)

    /// Warm hairline border — the OG border token / Radix bronze 6.
    static let border = dyn(0xe4cdb7, 0x3b3330)

    /// Completed-step green, nudged warm/desaturated so it sits with the
    /// bronze rather than the stock system green.
    static let success = dyn(0x3f8f54, 0x73c088)
}

extension View {
    /// Apply the cocore identity to a tray window's root view: tint every
    /// control bronze. One call per hosted root keeps all windows on-brand.
    func brandStyled() -> some View {
        self.tint(Brand.accent)
    }
}
