# Installing cocore on macOS

cocore turns an Apple Silicon Mac into a verifiable compute provider:
the agent receives encrypted prompts, runs them, and publishes
P-256-signed receipts to its ATProto repo. This page walks through
getting that running on a Mac (Mini or otherwise).

The **cocore menu-bar app** is the recommended way to run a provider:
a notarized macOS app that lives in your menu bar, handles sign-in,
shows status/earnings/models, and supervises the same headless agent
under the hood. Most people want Path A. The CLI-only paths (B/C) are
for headless boxes, scripted fleets, and developers.

## Path A — `curl | sh` (recommended)

The console hosts a one-liner that downloads the latest notarized
release and installs **both** the menu-bar app (to `/Applications`) and
the headless agent it drives:

```bash
curl -fsSL https://console.cocore.dev/agent | sh
```

That installs `/Applications/cocore.app` (Developer-ID-signed +
notarized — no Gatekeeper warning), drops the `cocore` CLI at
`~/.local/bin/cocore`, and configures the LaunchAgent. The app launches,
registers itself as a **login item** (so the tray icon returns after a
reboot), and walks you through pairing with your ATProto identity from
the menu — click **Sign in with ATProto**, approve in the browser, done.

Prefer to stay in the terminal? The same install also supports the CLI
pairing flow:

```bash
cocore agent pair
```

Env knobs (set before the `curl` if you need to override):
`COCORE_PREFIX`, `COCORE_RELEASE_TAG` (pin a version),
`COCORE_REPO`, `COCORE_SKIP_SERVICE` (skip the LaunchAgent),
`COCORE_SKIP_APP=1` (CLI only — don't install the menu-bar app).

A standalone, notarized `cocore.app.zip` is also published with each
release if you'd rather download + drag it to /Applications yourself.

## Path B — install in-place from a checkout

Fastest if the Mac already has a clone of the cocore repo.

```bash
git clone https://github.com/DGaffney/cocore.git
cd cocore
make mac-install
```

What that does:

1. Verifies macOS, Apple Silicon (warns on x86_64), and Xcode CLT.
2. Confirms a Rust toolchain (set `COCORE_INSTALL_RUST=1` to auto-install rustup).
3. `cargo build --release` from `provider/`.
4. Copies `cocore` to `~/.local/bin`.
5. Runs `cocore agent pair` to pair the machine with an ATProto
   identity (prints a code, opens the console for OAuth, polls until
   approved, persists the session at `~/.cocore/session.json`).
6. Installs `~/Library/LaunchAgents/dev.cocore.provider.plist` and
   loads it via `launchctl bootstrap`.

The install is idempotent: re-running upgrades the binary and reloads
the LaunchAgent without re-pairing.

### Pointing at a non-default console / advisor

Production defaults are `https://console.cocore.dev` and
`wss://advisor.cocore.dev/v1/agent`. Override per install:

```bash
COCORE_CONSOLE=http://localhost:3000 \
COCORE_ADVISOR=ws://localhost:8082/v1/agent \
make mac-install
```

These values are baked into the LaunchAgent plist, so the agent uses
them every restart without needing the env vars at runtime.

## Path C — distributable tarball

Use this when the Mac that will run the provider doesn't have a
checkout (or a Rust toolchain). Build the tarball on a build host
that does:

```bash
make mac-installer            # produces dist/cocore-mac-arm64.tar.gz
```

The tarball contains a release `cocore` binary plus the
install script and LaunchAgent template. Copy it to the target Mac
and run:

```bash
scp dist/cocore-mac-arm64.tar.gz mac-mini:~/
ssh mac-mini
tar -xzf cocore-mac-arm64.tar.gz
cd cocore-mac-arm64
./install.sh
```

Same env knobs apply (`COCORE_CONSOLE`, `COCORE_ADVISOR`, etc.).

## Verifying

```bash
~/.local/bin/cocore agent whoami
# did:    did:plc:...
# handle: yourhandle.bsky.social
# pds:    https://...

launchctl print gui/$(id -u)/dev.cocore.provider | head -20
# state = running
# pid   = ...

tail -f ~/.cocore/logs/stderr.log
```

## Uninstall

```bash
make mac-uninstall                      # in a checkout
COCORE_PURGE=1 make mac-uninstall       # also delete ~/.cocore (session + logs)
```

Or directly:

```bash
./scripts/uninstall-mac-provider.sh
```

Without a checkout — the hosted uninstaller does the same local wipe:

```bash
curl -fsSL https://console.cocore.dev/agent/uninstall | sh
```

Pass `--unpair` (or `COCORE_UNPAIR=1`) to also delete this machine's
provider record from your PDS in the same run, so the row disappears
from `/machines` without a second manual click:

```bash
curl -fsSL https://console.cocore.dev/agent/uninstall | sh -s -- --unpair
```

Either form leaves identity-level records (receipts, attestations
published in the past, API keys on the console) alone. Use
`/account → Wipe my data` for that.

## Layout after install

```
~/.local/bin/cocore           # the agent binary
~/.cocore/session.json                 # paired ATProto session, mode 0600
~/.cocore/logs/stdout.log              # captured stdout
~/.cocore/logs/stderr.log              # captured stderr (where tracing goes)
~/Library/LaunchAgents/
  dev.cocore.provider.plist            # LaunchAgent definition
```

## Common operator commands

| Command                                                     | What it does                              |
| ----------------------------------------------------------- | ----------------------------------------- |
| `cocore agent whoami`                                    | Show the paired identity                  |
| `cocore agent pair --console <URL>`                      | Re-pair against a different console       |
| `cocore agent serve --advisor <WSS>` (foreground)        | Run the agent in your shell, no launchd   |
| `launchctl kickstart -k gui/$(id -u)/dev.cocore.provider`   | Restart the LaunchAgent                   |
| `launchctl bootout gui/$(id -u)/dev.cocore.provider`        | Stop the LaunchAgent (re-loads at login)  |
| `tail -f ~/.cocore/logs/stderr.log`                         | Follow the agent log                      |
## Menu-bar app

The notarized **cocore.app** is installed by default (Path A) and is the
recommended way to run a provider. It lives in the macOS menu bar, has no
Dock icon, and registers itself as a login item so the tray icon returns
after a reboot. Opt out with `COCORE_SKIP_APP=1` (CLI + LaunchAgent only);
or install it standalone any time by downloading `cocore.app.zip` from the
release and dragging it to /Applications.

From its menu you can sign in / re-pair, start & pause serving, switch
models, open Preferences (network endpoints, serve schedule), view your
profile, see balance + 24h earnings (in credits), and uninstall. It drives
the same headless `cocore` CLI + `dev.cocore.provider` LaunchAgent under
the hood and holds no authoritative state of its own.

> This supersedes the earlier Rust `cocore agent menubar` companion. If a
> machine still has that running (`dev.cocore.menubar`), the uninstaller
> removes it.

## Trust level

The release binary attests as **hardware-attested** when run on Apple
Silicon with the Secure Enclave Swift framework linked
(`provider/enclave`). On x86_64 Macs, or if the Secure Enclave is
unavailable for any reason, the agent falls back to a software P-256
identity and registers as **self-attested**. Receipts in either mode
are cryptographically signed and verifiable; only the attestation's
declared `trustLevel` differs.

## Troubleshooting

- **`cargo: command not found`** — install Rust (https://rustup.rs) or
  pass `COCORE_INSTALL_RUST=1` to let the installer pull rustup.
- **LaunchAgent immediately exits** — `tail ~/.cocore/logs/stderr.log`.
  The most common cause is a missing or expired session: re-run
  `cocore agent pair` and `launchctl kickstart -k`.
- **`console returned 404 from devicePair.start`** — `COCORE_CONSOLE`
  points at something that isn't a cocore console; double-check the
  URL and that you can reach `/api/xrpc/dev.cocore.devicePair.start`.
- **Multiple Macs sharing one identity** — supported; each machine
  has its own session blob and signs with its own key. The receipts
  share a `requester`-side handle but bind to distinct attestation
  records, so an AppView can attribute work per-machine.
