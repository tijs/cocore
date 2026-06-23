# Secure release (WS-A): native MLX build → cdHash → known-good

The **default** co/core release ships the subprocess inference engine: the
agent decrypts the prompt and hands it to an owner-controlled Python child over
a Unix domain socket. No attestation covers that child, so the **confidential
tier cannot be served** by a default build.

The **secure/native** release builds the agent with `--features native_mlx`, so
inference runs **in-process** inside the measured, signed `cocore` binary (the
`libCoCoreMLX.dylib` engine + a precompiled `mlx.metallib`, both loaded under
library validation). Only this build can serve the confidential tier — and only
once its code-signing **cdHash** is registered as known-good.

> Display brand is **co/core**; identifiers stay **cocore** (NSIDs, env vars,
> binary name, bundle id). Don't rename identifiers to match the brand.

## The one hard rule

**The cdHash changes on every release.** It commits to the exact signed bytes of
the binary. The advisor only advertises a provider as confidential-eligible when
its measured cdHash is in `COCORE_KNOWN_GOOD_CDHASHES`
(`infra/advisor/src/known-good.ts`). If you cut a secure release and do **not**
register its new cdHash, every confidential request **silently downgrades to
best-effort** — no error, just a quiet loss of the guarantee.

> Register the new cdHash **before or with** every secure release.

The advisor is an *accelerator*, not the authority: a confidential requester
re-verifies the provider's signed PDS attestation against its **own** known-good
set at seal time. So the cdHash must reach **requesters** too — that's why the
release publishes it as the `cdhash.json` asset.

## What the cdHash and the engine hashes are

These match exactly what the running agent reports about itself, so an offline
extract equals the live measurement:

| Field | Source of truth at runtime | How we extract it offline |
| --- | --- | --- |
| `cdHash` | `provider/src/codesign.rs` via `csops(CS_OPS_CDHASH)` — the 20-byte CodeDirectory hash, = `codesign -dvvv`'s `CDHash=` | `codesign -d -vvv <bin>` → `CDHash=` line |
| `teamId` | `csops(CS_OPS_TEAMID)` | `codesign -dvvv` → `TeamIdentifier=` |
| `hardenedRuntime` | `CS_RUNTIME` (0x10000) flag | CodeDirectory `flags=` bitmask |
| `libraryValidation` | `CS_REQUIRE_LV` (0x2000) flag | CodeDirectory `flags=` bitmask |
| `engineLibHash` | `native_mlx.rs` SHA-256 of the loaded `libCoCoreMLX.dylib` | `shasum -a 256 libCoCoreMLX.dylib` |
| `metallibHash` | `native_mlx.rs` / `MLXEngine.locateMetallibHash` SHA-256 of `mlx.metallib` | `shasum -a 256 *.metallib` |

`scripts/extract-cdhash.sh` produces all of these as one JSON object.

## The flow

```
secure build → hardened sign + notarize → extract cdHash → register known-good → publish
```

### 1. Build the secure/native binary

The native engine needs the **Metal toolchain (full Xcode)**, because
`provider/build.rs` runs `swift build --product CoCoreMLX`, which compiles Metal
shaders. Command Line Tools alone are not enough.

Local / app-bundle build (hardened-signed + ready to notarize):

```bash
COCORE_BUILD_NATIVE=1 ./scripts/build-mac-app.sh
COCORE_NOTARY_PROFILE=cocore-notary ./scripts/notarize-mac-app.sh
```

`COCORE_BUILD_NATIVE=1` switches the cargo build to
`--features native_mlx`, bundles `libCoCoreMLX.dylib` + `mlx.metallib` next to
the CLI, and signs the dylib with library validation so the CLI's enforced
library validation accepts it. The default (unset) path is unchanged.

CI: trigger the `release` workflow with the **native** checkbox
(`workflow_dispatch` → `native: true`). A plain `v*` tag push always takes the
**default, non-native** path so ordinary releases keep shipping.

> CI does not hold Developer ID / notarization secrets, so the workflow
> **ad-hoc** signs only to *produce* a cdHash for inspection. An ad-hoc cdHash
> is **not** a distributable confidential build (no teamId, no library
> validation). A real secure release is Developer-ID signed + notarized
> locally, and its cdHash is extracted from **that** signed binary.

### 2. Extract the cdHash

```bash
./scripts/extract-cdhash.sh \
  provider-shell/build/cocore.app/Contents/MacOS/cocore > cdhash.json
cat cdhash.json
```

The optional second argument is the directory to search for the engine
artifacts; it defaults to the binary's own directory (where the build colocates
`libCoCoreMLX.dylib` and the metallib). On a non-native build both
`engineLibHash` and `metallibHash` are `null`. The script **errors on an
unsigned binary** — a known-good cdHash must come from a signed build.

The CI native path runs this for you and publishes the result as the
`cdhash.json` release asset, and prints the cdHash in the workflow run summary.

### 3. Register the cdHash as known-good (MANUAL, REQUIRED)

```bash
# Read the CURRENT advisor value first so you APPEND, never replace:
railway variables --service advisor | grep COCORE_KNOWN_GOOD_CDHASHES

# Then compute + apply the appended value:
COCORE_CURRENT_KNOWN_GOOD="<that value>" \
  ./scripts/register-known-good.sh cdhash.json
```

`register-known-good.sh` accepts a raw hex hash, a `cdhash.json` path, or JSON
on stdin. It validates the 40-hex-char shape, dedupes against the current set,
and prints the exact `railway variables --service advisor --set …` command — it
**does not** mutate Railway itself (a bad value would de-bless the whole fleet).
This is a deliberate documented manual step.

Old cdHashes can stay in the set for a grace window so providers mid-upgrade
stay confidential-eligible; prune them once the fleet has rolled forward.

### 4. Publish

The release (tarball + `cdhash.json` + checksums) goes out via the `release`
workflow's GitHub release step. Requesters fetch `cdhash.json` to seed their own
known-good set.

## Failure modes (and why they're safe)

- **Forgot to register** → advisor `KnownGoodSet` doesn't contain the cdHash →
  provider advertised as best-effort, confidential requests downgrade. No false
  "confidential" is ever asserted (fail-closed; see `known-good.ts` and
  `codesign.rs`'s unsafe-by-default `CodeSignInfo`).
- **Empty `COCORE_KNOWN_GOOD_CDHASHES`** → advisor blesses **nobody**.
- **Unsigned / ad-hoc binary** → `extract-cdhash.sh` errors (or reports no
  teamId / no library validation), so it can't masquerade as a blessed build.
- **Metallib missing** → the native engine reports `ready() == false` and the
  agent won't register confidential — correct, since GPU kernels can't load.

## Files

- `scripts/build-mac-app.sh` — `COCORE_BUILD_NATIVE=1` opt-in native build.
- `scripts/extract-cdhash.sh` — emit the `cdhash.json` blob from a signed binary.
- `scripts/register-known-good.sh` — show the exact advisor env update.
- `.github/workflows/release.yml` — `native` dispatch input wires it all in CI.
- `infra/advisor/src/known-good.ts` — reads `COCORE_KNOWN_GOOD_CDHASHES`.
- `provider/src/codesign.rs`, `provider/src/engines/native_mlx.rs` — the live
  measurements the offline extract must match.
