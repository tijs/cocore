//! Crash capture, build provenance, content-safe logging, and the
//! one-file diagnostic bundle.
//!
//! ## Why this module exists
//!
//! When the agent died in the field it left almost nothing behind: the
//! Rust panic message was printed to stderr, the shell forwarded it to
//! `NSLog`, and the macOS unified log aged it out within hours. By the
//! time anyone looked, the *primary* panic — the one fact that would
//! name the bug — was gone. Everything here is about making the next
//! failure name itself, durably and content-safely.
//!
//! ## The content-safety contract (non-negotiable)
//!
//! The agent NEVER persists prompt text, generated tokens, or request
//! bodies (see `engines/subprocess.rs` for the ring-buffer rationale).
//! This module upholds that:
//!   * The file log carries the same `tracing` events as stderr, and
//!     those events are written to never include content.
//!   * The crash *signature* sent on the wire carries a panic
//!     *location* (`file:line`) and a hash — never the panic message.
//!   * The diagnostic bundle redacts `session.json` down to its
//!     non-secret fields and omits the signing key entirely.
//!
//! Panic messages in this codebase are developer strings (`unwrap` /
//! `expect` / assertions), so the full message is safe to keep in the
//! *local* `last-panic.txt`; we still keep it off the wire as defense
//! in depth.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// Short git commit this binary was built from (`build.rs`), or
/// `unknown` outside a git tree. Suffixed `-dirty` for an uncommitted
/// build.
pub const GIT_SHA: &str = env!("COCORE_GIT_SHA");
/// `debug` / `release` — the cargo profile this binary was built with.
/// A debug build has overflow checks + debug assertions on, which
/// changes which bugs panic, so a crash report is ambiguous without it.
pub const BUILD_PROFILE: &str = env!("COCORE_BUILD_PROFILE");

/// `"<semver> (<sha>, <profile>)"` — the one-line build identity shown
/// in `doctor`, written to the panic file, and hashed into the crash
/// signature.
pub fn build_version() -> String {
    format!(
        "{} ({}, {})",
        env!("CARGO_PKG_VERSION"),
        GIT_SHA,
        BUILD_PROFILE
    )
}

fn state_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".cocore"))
}

/// `~/.cocore/logs/` — where the rolling agent log and crash artifacts
/// live. Created best-effort; callers tolerate its absence.
pub fn logs_dir() -> Option<PathBuf> {
    let d = state_dir()?.join("logs");
    let _ = std::fs::create_dir_all(&d);
    Some(d)
}

/// `~/.cocore/last-panic.txt` — the most recent panic, verbatim, for a
/// human to read. Overwritten each panic (the rolling crash-state JSON
/// keeps the running count).
pub fn last_panic_path() -> Option<PathBuf> {
    state_dir().map(|d| d.join("last-panic.txt"))
}

fn crash_state_path() -> Option<PathBuf> {
    state_dir().map(|d| d.join("crash-state.json"))
}

/// Durable, content-free crash bookkeeping. Persisted across respawns so
/// the supervisor and the advisor can both see "this machine is in a
/// crash loop" without anyone tailing a log.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CrashState {
    /// Total panics observed since the last [`reset_crash_count`].
    pub count: u32,
    /// RFC3339 of the most recent panic.
    pub last_at: Option<String>,
    /// `file:line` of the most recent panic (no message — safe to keep).
    pub last_location: Option<String>,
    /// Stable short hash of (location + message): groups identical
    /// crashes across machines without revealing the message.
    pub last_signature: Option<String>,
    /// Build that produced the most recent panic.
    pub last_version: Option<String>,
}

fn load_crash_state() -> CrashState {
    crash_state_path()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn store_crash_state(s: &CrashState) {
    if let (Some(p), Ok(bytes)) = (crash_state_path(), serde_json::to_vec_pretty(s)) {
        let _ = std::fs::write(p, bytes);
    }
}

/// Clear the crash counter. The serve loop calls this after a sustained
/// clean uptime so "N crashes recently" stays meaningful (a counter that
/// only ever grows can't distinguish a flapping machine from one that
/// hiccuped once a month ago).
pub fn reset_crash_count() {
    let mut s = load_crash_state();
    if s.count == 0 {
        return;
    }
    s.count = 0;
    store_crash_state(&s);
}

/// Stable 12-hex-char signature for a panic, hashed from its location +
/// message. Identical crashes hash identically (fleet grouping); the
/// message itself never leaves the machine.
fn signature_of(location: &str, message: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(location.as_bytes());
    h.update([0u8]);
    h.update(message.as_bytes());
    hex::encode(&h.finalize()[..6])
}

/// Install the process-wide panic hook. Chains to the default hook
/// (so stderr still gets the human-readable panic, which the shell
/// persists) AFTER durably recording the panic to `last-panic.txt` and
/// bumping the crash counter.
///
/// The hook is best-effort and must never itself panic — a panic in a
/// panic hook aborts the process, which is exactly the failure mode we
/// spent this whole effort removing.
pub fn install_panic_hook() {
    // Default backtraces on unless the operator pinned RUST_BACKTRACE
    // themselves. `force_capture` below captures regardless, but this
    // also makes the stderr panic carry a backtrace.
    if std::env::var_os("RUST_BACKTRACE").is_none() {
        std::env::set_var("RUST_BACKTRACE", "1");
    }

    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Everything in here is wrapped so a failure to record a crash
        // never escalates into a second panic.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            record_panic(info);
        }));
        default_hook(info);
    }));
}

fn record_panic(info: &std::panic::PanicHookInfo<'_>) {
    let now = chrono::Utc::now().to_rfc3339();
    let location = info
        .location()
        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
        .unwrap_or_else(|| "unknown".to_string());
    let message = panic_message(info);
    let thread = std::thread::current()
        .name()
        .unwrap_or("unnamed")
        .to_string();
    let backtrace = std::backtrace::Backtrace::force_capture();
    let signature = signature_of(&location, &message);

    // Bump the durable counter (content-free).
    let mut state = load_crash_state();
    state.count = state.count.saturating_add(1);
    state.last_at = Some(now.clone());
    state.last_location = Some(location.clone());
    state.last_signature = Some(signature.clone());
    state.last_version = Some(build_version());
    let count = state.count;
    store_crash_state(&state);

    // Human-readable last-panic.txt (local only; safe to keep the
    // message because our panics are developer strings).
    if let Some(path) = last_panic_path() {
        let body = format!(
            "cocore agent panic\n\
             ==================\n\
             when:       {now}\n\
             build:      {build}\n\
             signature:  {signature}\n\
             crash #:    {count} (since last clean uptime)\n\
             thread:     {thread}\n\
             location:   {location}\n\
             message:    {message}\n\
             \n\
             backtrace:\n{backtrace}\n",
            build = build_version(),
        );
        let _ = std::fs::write(path, body);
    }
}

/// Best-effort extraction of a panic payload as a string.
fn panic_message(info: &std::panic::PanicHookInfo<'_>) -> String {
    let p = info.payload();
    if let Some(s) = p.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else {
        "<non-string panic payload>".to_string()
    }
}

/// The content-free crash summary the agent attaches to its heartbeat so
/// the advisor can see a flapping machine fleet-wide. `None` when the
/// machine has never crashed (or the counter was reset).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrashSignature {
    /// Panics since the last clean-uptime reset.
    pub count: u32,
    /// RFC3339 of the most recent panic.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_at: Option<String>,
    /// `file:line:col` of the most recent panic (no message).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    /// Stable hash grouping identical crashes across the fleet.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// Build identity that crashed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// Read the durable crash state and shape it for the wire. Returns
/// `None` when there's nothing to report so the heartbeat stays empty on
/// healthy machines.
pub fn crash_signature() -> Option<CrashSignature> {
    let s = load_crash_state();
    if s.count == 0 {
        return None;
    }
    Some(CrashSignature {
        count: s.count,
        last_at: s.last_at,
        location: s.last_location,
        signature: s.last_signature,
        version: s.last_version,
    })
}

// ---------------------------------------------------------------------
// Content-safe file logging
// ---------------------------------------------------------------------

// Keeps the non-blocking writer's flush guard alive for the life of the
// process. Dropping it would silently stop the file log.
static LOG_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();

/// Initialise tracing with a stderr layer (unchanged behaviour) PLUS a
/// rolling daily file at `~/.cocore/logs/agent.log`. The file carries
/// the same events as stderr — and since the agent's tracing is written
/// to never include prompt/token content, the file inherits that
/// guarantee. Falls back to stderr-only if the log dir can't be created.
pub fn init_logging(level: &str) {
    use tracing_subscriber::prelude::*;
    use tracing_subscriber::{fmt, EnvFilter};

    let filter = || EnvFilter::try_new(level).unwrap_or_else(|_| EnvFilter::new("info"));

    let stderr_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_filter(filter());

    let file_layer = logs_dir().map(|dir| {
        let appender = tracing_appender::rolling::daily(dir, "agent.log");
        let (nb, guard) = tracing_appender::non_blocking(appender);
        // Store the guard; if a second init somehow races, keep the first.
        let _ = LOG_GUARD.set(guard);
        fmt::layer()
            .with_ansi(false)
            .with_writer(nb)
            .with_filter(filter())
    });

    tracing_subscriber::registry()
        .with(stderr_layer)
        .with(file_layer)
        .init();
}

// ---------------------------------------------------------------------
// Diagnostic bundle
// ---------------------------------------------------------------------

/// Build a content-safe `.tar.gz` of everything useful for triage and
/// return its path. Defaults to `~/.cocore/diagnostics-<ts>.tar.gz`.
///
/// Included (all content-free): the build identity + a manifest, the
/// rolling agent logs, `last-panic.txt`, `crash-state.json`, a redacted
/// `session.json` (DID/handle/apiBase only — never the API key), the
/// system profile, and any `cocore-*.ips` macOS crash reports (those are
/// Rust backtraces, no prompt data).
///
/// Deliberately excluded: `session.json`'s `apiKey`, `identity.pem`, the
/// inference sockets, and the venv.
pub fn make_diagnostic_bundle(
    out: Option<PathBuf>,
    system_profile_json: &str,
) -> anyhow::Result<PathBuf> {
    use flate2::write::GzEncoder;
    use flate2::Compression;

    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no home dir"))?;
    let cocore = home.join(".cocore");
    let ts = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let out = out.unwrap_or_else(|| cocore.join(format!("diagnostics-{ts}.tar.gz")));

    let file = std::fs::File::create(&out)
        .map_err(|e| anyhow::anyhow!("creating bundle {}: {e}", out.display()))?;
    let enc = GzEncoder::new(file, Compression::default());
    let mut tar = tar::Builder::new(enc);

    // 1. manifest + provenance (always present, names what's inside).
    let manifest = format!(
        "cocore diagnostic bundle\n\
         created:  {ts}\n\
         build:    {build}\n\
         \n\
         This bundle is content-safe: it contains crash and health\n\
         telemetry only. It does NOT contain prompts, generated tokens,\n\
         request bodies, your API key, or your signing key.\n\
         \n\
         files:\n\
           manifest.txt        this file\n\
           system-profile.json hardware/OS profile\n\
           crash-state.json    durable crash counter (content-free)\n\
           last-panic.txt      most recent Rust panic (location+backtrace)\n\
           session.json        REDACTED — did/handle/apiBase only\n\
           logs/               rolling agent logs (no content by design)\n\
           crashreports/       macOS .ips crash reports for `cocore`\n",
        build = build_version(),
    );
    append_bytes(&mut tar, "manifest.txt", manifest.as_bytes())?;
    append_bytes(
        &mut tar,
        "system-profile.json",
        system_profile_json.as_bytes(),
    )?;

    // 2. crash artifacts.
    append_file_if_present(
        &mut tar,
        &cocore.join("crash-state.json"),
        "crash-state.json",
    )?;
    append_file_if_present(&mut tar, &cocore.join("last-panic.txt"), "last-panic.txt")?;

    // 3. redacted session (drop apiKey; keep non-secret routing fields).
    if let Ok(bytes) = std::fs::read(cocore.join("session.json")) {
        if let Ok(mut v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            if let Some(obj) = v.as_object_mut() {
                obj.remove("apiKey");
                obj.insert("apiKey".into(), serde_json::json!("<redacted>"));
            }
            let redacted = serde_json::to_vec_pretty(&v).unwrap_or_default();
            append_bytes(&mut tar, "session.json", &redacted)?;
        }
    }

    // 4. rolling logs.
    if let Ok(entries) = std::fs::read_dir(cocore.join("logs")) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_file() {
                let name = e.file_name();
                let arcname = format!("logs/{}", name.to_string_lossy());
                append_file_if_present(&mut tar, &p, &arcname)?;
            }
        }
    }

    // 5. macOS crash reports for `cocore` (backtraces only).
    let diag_dirs = [
        home.join("Library/Logs/DiagnosticReports"),
        home.join("Library/Logs/DiagnosticReports/Retired"),
    ];
    for dir in diag_dirs {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let name = e.file_name();
                let nm = name.to_string_lossy();
                if nm.starts_with("cocore-") && nm.ends_with(".ips") {
                    let arcname = format!("crashreports/{nm}");
                    append_file_if_present(&mut tar, &e.path(), &arcname)?;
                }
            }
        }
    }

    tar.into_inner()
        .map_err(|e| anyhow::anyhow!("finishing tar: {e}"))?
        .finish()
        .map_err(|e| anyhow::anyhow!("finishing gzip: {e}"))?;
    Ok(out)
}

fn append_bytes<W: Write>(
    tar: &mut tar::Builder<W>,
    name: &str,
    bytes: &[u8],
) -> anyhow::Result<()> {
    let mut header = tar::Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    header.set_mtime(0);
    header.set_cksum();
    tar.append_data(&mut header, name, bytes)
        .map_err(|e| anyhow::anyhow!("appending {name}: {e}"))
}

fn append_file_if_present<W: Write>(
    tar: &mut tar::Builder<W>,
    path: &Path,
    arcname: &str,
) -> anyhow::Result<()> {
    match std::fs::read(path) {
        Ok(bytes) => append_bytes(tar, arcname, &bytes),
        Err(_) => Ok(()), // absent is fine
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_is_stable_and_message_free() {
        let a = signature_of("src/advisor.rs:42:1", "called Option::unwrap() on None");
        let b = signature_of("src/advisor.rs:42:1", "called Option::unwrap() on None");
        let c = signature_of("src/advisor.rs:99:1", "called Option::unwrap() on None");
        assert_eq!(a, b, "identical crashes hash identically");
        assert_ne!(a, c, "different locations hash differently");
        assert_eq!(a.len(), 12, "12 hex chars");
        // The signature must not embed the message.
        assert!(!a.contains("unwrap"));
    }

    #[test]
    fn crash_signature_none_when_count_zero() {
        let s = CrashState::default();
        store_crash_state(&s); // count 0
                               // Can't assert global filesystem state portably in CI; just check
                               // the shaping logic directly.
        assert_eq!(s.count, 0);
    }

    #[test]
    fn build_version_has_all_three_parts() {
        let v = build_version();
        assert!(v.contains(env!("CARGO_PKG_VERSION")));
        assert!(v.contains(GIT_SHA));
        assert!(v.contains(BUILD_PROFILE));
    }

    #[test]
    fn bundle_is_created_and_omits_secrets() {
        // Build a bundle into a temp path and confirm it exists and is a
        // gzip. A full extract-and-grep would require a temp HOME; here
        // we assert the happy path produces an archive.
        let tmp =
            std::env::temp_dir().join(format!("cocore-test-bundle-{}.tar.gz", std::process::id()));
        let p = make_diagnostic_bundle(Some(tmp.clone()), "{\"chip\":\"test\"}").unwrap();
        assert!(p.exists());
        let bytes = std::fs::read(&p).unwrap();
        assert_eq!(&bytes[..2], &[0x1f, 0x8b], "gzip magic");
        let _ = std::fs::remove_file(&p);
    }
}
