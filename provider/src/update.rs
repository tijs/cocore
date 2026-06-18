//! `cocore agent update` — pull the latest release through the
//! console's GitHub-releases proxy and replace the installed binary
//! atomically. macOS-only today (the installer is mac-only). With
//! `--check`, only print the latest version + comparison.
//!
//! Trust path: same as the install script. The console proxies
//! `/agent/version` (returns the latest tag) and `/agent/dl?tag=…`
//! (streams the prebuilt tarball through GITHUB_TOKEN). The user
//! already trusts the console with their OAuth session and API key
//! — having `cocore agent update` use the same proxy means we don't
//! introduce a new trust surface.
//!
//! What this does, in order:
//!   1. GET /agent/version → latest tag.
//!   2. Compare to env!("CARGO_PKG_VERSION"). With `--check`, exit.
//!   3. GET /agent/dl?tag=<latest> → tarball bytes.
//!   4. Extract to a tmpfile next to the current binary.
//!   5. Atomic rename to current_exe(). On macOS this is permitted
//!      even while the binary is running.
//!   6. Kickstart the LaunchAgent so the daemon picks up the new
//!      binary immediately instead of on next reboot.
//!
//! Any step failing exits non-zero with a printable error. We don't
//! roll back automatically (the atomic rename is the rollback boundary
//! — if the rename succeeds, the new binary is in place; if it fails,
//! the old binary is still there).

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

const REQUEST_TIMEOUT_SECS: u64 = 60; // tarball download

// v0.5.x shipped two tarball variants (stub vs. inference). v0.6.0
// collapsed them into a single binary that always supports real
// inference (via the subprocess engine — see `engines::subprocess`).
// No variant detection here anymore; the download URL is just
// `<console>/agent/dl?tag=<tag>`. The migration path for upgrading
// from v0.5.x → v0.6.0 is to re-run the installer, which provisions
// the new uv-managed Python venv that the subprocess engine needs.

pub async fn run(console: &str, check_only: bool) -> Result<()> {
    let console = console.trim_end_matches('/');
    let installed = format!("v{}", env!("CARGO_PKG_VERSION"));
    let arch = current_arch_label()?;
    println!("==> cocore agent update");
    println!("  installed: {installed}");
    println!("  arch:      {arch}");

    // 1 + 2.
    let latest = fetch_latest_tag(console).await?;
    println!("  latest:    {latest}");
    if latest == installed {
        println!("Already on the latest release. Nothing to do.");
        return Ok(());
    }
    println!("Newer release available: {installed} → {latest}");
    if check_only {
        println!("`--check` set; not applying. Re-run without `--check` to install.");
        return Ok(());
    }

    // 3. Single-variant download — no `&variant=...` query param.
    // The 0.6.0+ console proxy serves the unified tarball.
    let url = format!("{console}/agent/dl?tag={latest}");
    println!("==> downloading {url}");
    let bytes = download_tarball(&url).await?;
    println!("  size: {} bytes", bytes.len());

    // 4. Extract to a sibling tmp path.
    let target = std::env::current_exe().context("current_exe")?;
    let tmp = staging_path_next_to(&target);
    extract_cocore_binary(&bytes, &tmp).context("extract binary from tarball")?;
    println!("  extracted: {}", tmp.display());

    // 5. Atomic replace.
    std::fs::rename(&tmp, &target)
        .with_context(|| format!("rename {} → {}", tmp.display(), target.display()))?;
    // Make sure the new binary is executable; some tarballs lose +x.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755));
    }
    println!("  installed: {}", target.display());

    // 6. Kickstart the LaunchAgents. Provider first; the menubar
    // bounce goes last because when this update was launched FROM
    // the menu-bar app, restarting dev.cocore.menubar kills our
    // parent — everything before this line must already be done.
    bounce_launchagent_if_installed();
    bounce_menubar_if_installed();
    Ok(())
}

/// Best-effort restart of the menu-bar companion (if installed) so it
/// runs the just-installed binary. Silent when the LaunchAgent isn't
/// present — most CLI-only installs won't have it.
#[cfg(target_os = "macos")]
fn bounce_menubar_if_installed() {
    use std::process::Command;
    let uid = unsafe { libc::getuid() };
    let target = format!("gui/{uid}/dev.cocore.menubar");
    let installed = Command::new("launchctl")
        .args(["print", &target])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !installed {
        return;
    }
    let bounced = Command::new("launchctl")
        .args(["kickstart", "-k", &target])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if bounced {
        println!("==> bounced menu-bar app — it now runs the new binary.");
    }
}

#[cfg(not(target_os = "macos"))]
fn bounce_menubar_if_installed() {}

async fn fetch_latest_tag(console: &str) -> Result<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;
    let url = format!("{console}/agent/version");
    let resp = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?;
    if !resp.status().is_success() {
        bail!("GET {url} returned {}", resp.status());
    }
    let body = resp.text().await.context("read version response")?;
    Ok(body.trim().to_string())
}

async fn download_tarball(url: &str) -> Result<Vec<u8>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()?;
    let resp = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?;
    if !resp.status().is_success() {
        bail!("GET {url} returned {}", resp.status());
    }
    let bytes = resp.bytes().await.context("read tarball body")?;
    Ok(bytes.to_vec())
}

/// Pick a sibling path the rename below will replace atomically.
/// Same directory ensures the rename is intra-filesystem (POSIX
/// requires that for atomic rename).
fn staging_path_next_to(target: &Path) -> PathBuf {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    parent.join(".cocore.update.tmp")
}

fn current_arch_label() -> Result<&'static str> {
    // Match the labels the installer + /agent/dl uses.
    let arch = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "arm64",
        ("macos", "x86_64") => "x86_64",
        ("linux", "x86_64") => "linux-x86_64",
        ("linux", "aarch64") => "linux-arm64",
        (os, arch) => bail!("unsupported {os}/{arch}; install manually"),
    };
    Ok(arch)
}

/// The release tarball ships as `cocore-<tag>-<arch>.tar.gz` and
/// contains a single `cocore` binary at the root. Extract just that
/// file (not anywhere on the filesystem — we want it next to the
/// current binary, then atomic-rename into place).
fn extract_cocore_binary(bytes: &[u8], dest: &Path) -> Result<()> {
    let gz = flate2::read::GzDecoder::new(bytes);
    let mut tar = tar::Archive::new(gz);
    for entry in tar.entries().context("read tar entries")? {
        let mut entry = entry.context("read tar entry")?;
        let path = entry.path().context("entry path")?;
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name == "cocore" {
            let mut out = std::fs::File::create(dest)
                .with_context(|| format!("create {}", dest.display()))?;
            std::io::copy(&mut entry, &mut out)
                .with_context(|| format!("copy to {}", dest.display()))?;
            return Ok(());
        }
        // Drain anything else; tar requires us to advance even when we
        // don't keep the bytes.
        std::io::copy(&mut entry, &mut std::io::sink()).ok();
    }
    bail!("no `cocore` binary found in the tarball")
}

#[cfg(target_os = "macos")]
fn bounce_launchagent_if_installed() {
    use std::process::Command;
    let uid = unsafe { libc::getuid() };
    let target = format!("gui/{uid}/dev.cocore.provider");
    let installed = Command::new("launchctl")
        .args(["print", &target])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !installed {
        println!("Note: no LaunchAgent at {target}. If serve is running another way, restart it manually.");
        return;
    }
    let bounced = Command::new("launchctl")
        .args(["kickstart", "-k", &target])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if bounced {
        println!("==> bounced LaunchAgent — the new binary is now serving.");
    } else {
        println!(
            "Warning: could not bounce {target}. Run `launchctl kickstart -k {target}` manually."
        );
    }
}

#[cfg(not(target_os = "macos"))]
fn bounce_launchagent_if_installed() {
    println!("Note: not on macOS; restart your serve daemon manually to pick up the new binary.");
}
