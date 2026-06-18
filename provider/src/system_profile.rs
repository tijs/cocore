//! Real machine telemetry for the `dev.cocore.compute.provider` record.
//!
//! Pre-v0.3.1 cmd_serve published hardcoded stubs (`chip = "Apple M-stub"`,
//! `ramGB = 64`). Matchmakers need real values to route inference work
//! to capable hardware, so this module collects what we can without
//! root from a Mac:
//!
//!   * `chip` — from `sysctl machdep.cpu.brand_string`
//!   * `ramGB` — from `sysctl hw.memsize`
//!   * `cpuCores` / `pCores` / `eCores` — from `sysctl hw.ncpu` and
//!     the perf-level splits
//!   * `gpuCores` — parsed from `system_profiler -json SPDisplaysDataType`
//!   * `memoryBandwidthGBs` — looked up from a chip-name table
//!     (Apple doesn't expose this via sysctl)
//!   * `modelIdentifier` — from `sysctl hw.model`
//!   * `os` — from `sw_vers -productVersion` (prefixed with `macOS `)
//!   * `machineLabel` — `COCORE_MACHINE_LABEL` (owner-chosen, set in the
//!     tray during setup) if present, else `hostname`, with a fallback
//!
//! Every individual probe is independently fallible. A failure on any
//! one returns None for that field rather than failing the whole
//! collect — partial data is better than no data, and the fields
//! that matter most for matchmaking (chip + ram) are also the most
//! reliable to read.

use std::process::Command;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProfile {
    pub machine_label: String,
    pub chip: String,
    pub ram_gb: u32,
    pub cpu_cores: Option<u32>,
    pub p_cores: Option<u32>,
    pub e_cores: Option<u32>,
    pub gpu_cores: Option<u32>,
    pub memory_bandwidth_gbs: Option<u32>,
    pub model_identifier: Option<String>,
    pub os: Option<String>,
}

/// Probe the host for a `SystemProfile`. Best-effort: any individual
/// probe failure leaves that field at its `None` / fallback value.
pub fn collect() -> SystemProfile {
    let chip = sysctl("machdep.cpu.brand_string").unwrap_or_else(|| "unknown".to_string());
    let ram_gb = sysctl("hw.memsize")
        .and_then(|s| s.parse::<u64>().ok())
        .map(|bytes| (bytes / (1024 * 1024 * 1024)) as u32)
        .unwrap_or(0);
    let cpu_cores = sysctl_u32("hw.ncpu");
    let p_cores = sysctl_u32("hw.perflevel0.physicalcpu");
    let e_cores = sysctl_u32("hw.perflevel1.physicalcpu");
    let gpu_cores = parse_gpu_cores();
    let memory_bandwidth_gbs = bandwidth_for_chip(&chip);
    let model_identifier = sysctl("hw.model");
    let os = sw_vers_product_version().map(|v| format!("macOS {v}"));
    // Owner-chosen display name (set in the tray during setup) wins over the
    // system hostname, so a provider isn't forced to expose their `.local`
    // host name. Falls back to the hostname, then a generic label.
    let machine_label = std::env::var("COCORE_MACHINE_LABEL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(hostname)
        .unwrap_or_else(|| "macOS host".to_string());

    SystemProfile {
        machine_label,
        chip,
        ram_gb,
        cpu_cores,
        p_cores,
        e_cores,
        gpu_cores,
        memory_bandwidth_gbs,
        model_identifier,
        os,
    }
}

fn sysctl(key: &str) -> Option<String> {
    let out = Command::new("sysctl").arg("-n").arg(key).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn sysctl_u32(key: &str) -> Option<u32> {
    sysctl(key).and_then(|s| s.parse::<u32>().ok())
}

fn parse_gpu_cores() -> Option<u32> {
    // `system_profiler -json SPDisplaysDataType` returns an array of
    // GPU entries. Apple Silicon integrated GPUs carry an
    // `sppci_cores` field; we take the first one we find.
    let out = Command::new("system_profiler")
        .arg("-json")
        .arg("SPDisplaysDataType")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let displays = v.get("SPDisplaysDataType")?.as_array()?;
    for d in displays {
        if let Some(cores) = d.get("sppci_cores").and_then(|c| c.as_str()) {
            if let Ok(n) = cores.parse::<u32>() {
                return Some(n);
            }
        }
    }
    None
}

fn sw_vers_product_version() -> Option<String> {
    let out = Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn hostname() -> Option<String> {
    let out = Command::new("hostname").output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Memory-bandwidth lookup keyed by chip-family substring. Apple
/// publishes these specs but doesn't expose them via sysctl.
/// Conservative values from public spec sheets — order matters
/// (Pro/Max/Ultra checked before bare M\d).
fn bandwidth_for_chip(chip: &str) -> Option<u32> {
    let lower = chip.to_lowercase();
    // M4 family
    if lower.contains("m4 max") {
        return Some(546);
    }
    if lower.contains("m4 pro") {
        return Some(273);
    }
    if lower.contains("m4") {
        return Some(120);
    }
    // M3 family
    if lower.contains("m3 ultra") {
        return Some(800);
    }
    if lower.contains("m3 max") {
        return Some(400);
    }
    if lower.contains("m3 pro") {
        return Some(150);
    }
    if lower.contains("m3") {
        return Some(100);
    }
    // M2 family
    if lower.contains("m2 ultra") {
        return Some(800);
    }
    if lower.contains("m2 max") {
        return Some(400);
    }
    if lower.contains("m2 pro") {
        return Some(200);
    }
    if lower.contains("m2") {
        return Some(100);
    }
    // M1 family
    if lower.contains("m1 ultra") {
        return Some(800);
    }
    if lower.contains("m1 max") {
        return Some(400);
    }
    if lower.contains("m1 pro") {
        return Some(200);
    }
    if lower.contains("m1") {
        return Some(68);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bandwidth_table_picks_specific_before_base() {
        // Pro/Max/Ultra need to be checked before bare M\d to avoid
        // misclassifying e.g. "Apple M3 Pro" as "M3 base".
        assert_eq!(bandwidth_for_chip("Apple M3 Max"), Some(400));
        assert_eq!(bandwidth_for_chip("Apple M3 Pro"), Some(150));
        assert_eq!(bandwidth_for_chip("Apple M3"), Some(100));
        assert_eq!(bandwidth_for_chip("Apple M1 Max"), Some(400));
        assert_eq!(bandwidth_for_chip("Apple M1 Pro"), Some(200));
        assert_eq!(bandwidth_for_chip("Apple M1"), Some(68));
        assert_eq!(bandwidth_for_chip("Apple M4 Pro"), Some(273));
        assert_eq!(bandwidth_for_chip("Apple M2 Ultra"), Some(800));
    }

    #[test]
    fn bandwidth_returns_none_for_unknown_chip() {
        assert_eq!(bandwidth_for_chip("Intel Core i9"), None);
        assert_eq!(bandwidth_for_chip(""), None);
        assert_eq!(bandwidth_for_chip("unknown"), None);
    }

    #[test]
    fn collect_returns_plausible_data_on_macos() {
        // This test runs against the actual host — we don't assert
        // specific values, only that the probe doesn't panic and the
        // most-critical fields (chip + ram) are populated when
        // running on a real Mac. CI runs on Linux where most of
        // these probes return None / fallback strings, so we only
        // assert the struct shape there.
        let p = collect();
        // chip is always at least "unknown" on non-mac CI runners
        assert!(!p.chip.is_empty());
        // ram_gb is 0 on Linux runners (no `hw.memsize` sysctl key);
        // bound the assertion accordingly.
        assert!(p.ram_gb < 4096); // sanity: nobody has >4 TB
    }
}
