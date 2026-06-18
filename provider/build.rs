//! Build-time provenance.
//!
//! Embeds the git commit and build profile into the binary as
//! compile-time env vars so `cocore agent doctor`, the panic file, and
//! the crash-signature heartbeat can report exactly which build is
//! running. Crash reports that don't carry a build identity are nearly
//! useless across a fleet on mixed versions — this closes that gap with
//! zero runtime cost.
//!
//! Everything here is best-effort: a source tree built outside git (a
//! release tarball, a vendored checkout) still compiles, just with
//! `unknown` for the sha.

use std::process::Command;

fn main() {
    // Re-run if HEAD moves so the embedded sha stays honest across
    // commits without a full clean.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-env-changed=COCORE_GIT_SHA");

    let sha = std::env::var("COCORE_GIT_SHA").ok().or_else(|| {
        Command::new("git")
            .args(["rev-parse", "--short=12", "HEAD"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    });
    let dirty = Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);

    let sha = match (sha, dirty) {
        (Some(s), true) => format!("{s}-dirty"),
        (Some(s), false) => s,
        (None, _) => "unknown".to_string(),
    };
    println!("cargo:rustc-env=COCORE_GIT_SHA={sha}");

    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "unknown".to_string());
    println!("cargo:rustc-env=COCORE_BUILD_PROFILE={profile}");
}
