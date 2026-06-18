# cocore shell (provider-shell)

Native macOS menu bar app that wraps the headless `cocore`
Rust agent. v1.5 of the provider experience: replaces the M2 device-pair
code flow with embedded ATProto OAuth, adds a status menu, a preferences
window, and the launchd-style supervision the Rust binary needs to run
unattended.

The Rust agent is still the only thing that ever decrypts a prompt.
This shell does identity, scheduling, and status; it does not see
inference data.

## Layout

```
provider-shell/
  Package.swift                 # SPM manifest, depends on ../provider/enclave
  Sources/CoCoreShell/
    CocoreShellApp.swift        # SwiftUI entry, AppDelegate, AppState
    MenuBarController.swift     # NSStatusItem menu
    AgentSupervisor.swift       # spawns + monitors cocore
    OAuthFlow.swift             # ASWebAuthenticationSession + SessionStore
    PreferencesView.swift       # SwiftUI settings tabs
    Resources/
      Info.plist                # LSUIElement=true, no dock icon
      cocore.entitlements       # Hardened Runtime, no get-task-allow
```

The Secure Enclave Swift framework that the Rust agent FFIs into lives
in a sibling package at `provider/enclave/` and is consumed both here
(as a Swift dependency) and by the Rust crate (as a static C library at
build time).

## Build & sign (release)

You need:

- macOS 13+ build host
- Xcode 15+
- An Apple Developer account; a Developer ID Application certificate
  in the keychain (for distribution outside the App Store)
- The Rust toolchain and a release build of `cocore`:
  `cd provider && cargo build --release --features secure_enclave`

Steps:

```bash
# 1. Open the package in Xcode and create a new Target wrapping it
#    as a macOS app (LSUIElement, status-bar-only).

# 2. Set the entitlements file to Sources/CoCoreShell/Resources/cocore.entitlements
#    and the Info.plist to Sources/CoCoreShell/Resources/Info.plist.

# 3. In the target's Build Phases, add a "Copy Files" phase that copies
#    provider/target/release/cocore into Contents/MacOS/.

# 4. Archive and notarize:
xcodebuild -scheme CoCoreShell -configuration Release archive \
  -archivePath build/cocore.xcarchive \
  CODE_SIGN_IDENTITY="Developer ID Application: ..." \
  OTHER_CODE_SIGN_FLAGS="--timestamp"

xcodebuild -exportArchive \
  -archivePath build/cocore.xcarchive \
  -exportOptionsPlist tools/export-options.plist \
  -exportPath build/

xcrun notarytool submit build/cocore.app.zip \
  --keychain-profile "AC_notary" --wait

xcrun stapler staple build/cocore.app
```

`tools/export-options.plist` is a four-line plist that selects
`developer-id` distribution. We don't ship a default; create one when
you set up signing.

## Dev loop (no signing)

For day-to-day work without a Developer ID:

```bash
swift build               # type-checks the package
swift run CoCoreShell     # launches an unsigned, ad-hoc-signed app
                          #   (no Hardened Runtime, no Secure Enclave;
                          #    use the software P-256 fallback)
```

`swift run` won't pass the entitlements check, so on a real machine the
agent registers as `self-attested` until you rebuild via Xcode with the
release entitlements applied.

### A runnable `.app` without Xcode

`swift run` launches the executable but doesn't give you a real bundle
(so the status item isn't a recognizable, installable app). To get a
double-clickable, ad-hoc-signed `cocore.app` straight from `swift
build` — no Xcode required:

```bash
./scripts/build-mac-app.sh          # -> provider-shell/build/cocore.app
OPEN=1 ./scripts/build-mac-app.sh   # build then launch it
```

The tray icon (`MenuBarController.brandImage()`) is the brand
"receipt notch" mark from `packages/console/public/favicon.svg`, drawn
with `NSBezierPath` as a menu-bar template image (no raster asset, so
it stays crisp at any backing scale and auto-tints for light/dark).
This path is for local dev/verification; distribution still uses the
Developer ID + notarize flow above.

## Why a Swift menu bar app at all

We ship the v1 device-pair CLI flow (`cocore agent pair`) for users
who'd rather scripts. The menu bar app is a sales-and-onboarding
surface: it gives an Apple-Silicon Mac owner a one-double-click way to
become a provider, see attestation health at a glance, and check
earnings without curling an AppView. The Rust agent does not depend on
it; nothing in the receipt chain changes when this app is absent.

## What's not in v1.5

- A full earnings chart (we show a single 24h figure; charts wait for
  the AppView's `getProviderStats`).
- A scheduling editor richer than the start/end-hour pair.
- Auto-update. Use `xcrun stapler` + Sparkle in M6.
