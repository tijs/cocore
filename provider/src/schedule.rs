//! Optional daily serve window for the agent.
//!
//! When `COCORE_SERVE_START` and `COCORE_SERVE_END` (hours 0–23, local
//! time) are both set and differ, the agent only connects to the
//! advisor during `[start, end)` and disconnects + frees its inference
//! engines outside it. Absent or invalid → serve continuously (the
//! historical behavior).
//!
//! Hour granularity matches the menu-bar app's Schedule UI, which is the
//! only writer of these env vars (via the LaunchAgent plist). Keeping it
//! coarse sidesteps DST/leap-second edge cases — a serve window is a
//! "don't compete with my daytime use" knob, not a billing boundary.

use chrono::{Local, Timelike};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ServeWindow {
    /// Inclusive start hour, 0–23 (local time).
    pub start: u8,
    /// Exclusive end hour, 0–23 (local time).
    pub end: u8,
}

impl ServeWindow {
    /// Read the window from `COCORE_SERVE_START` / `COCORE_SERVE_END`.
    /// Returns `None` (serve continuously) when either is unset or the
    /// pair is invalid (out of range, or start == end).
    pub fn from_env() -> Option<ServeWindow> {
        let start = parse_hour(&std::env::var("COCORE_SERVE_START").ok()?)?;
        let end = parse_hour(&std::env::var("COCORE_SERVE_END").ok()?)?;
        ServeWindow::new(start, end)
    }

    pub fn new(start: u8, end: u8) -> Option<ServeWindow> {
        if start > 23 || end > 23 || start == end {
            return None;
        }
        Some(ServeWindow { start, end })
    }

    /// Is `hour` (0–23) inside the window? Handles a window that wraps
    /// past midnight (e.g. 22→8).
    pub fn contains(&self, hour: u8) -> bool {
        if self.start < self.end {
            hour >= self.start && hour < self.end
        } else {
            hour >= self.start || hour < self.end
        }
    }

    /// Whether the window is open right now (local time).
    pub fn contains_now(&self) -> bool {
        self.contains(local_hour())
    }

    /// Seconds from now until the window next closes. Meaningful while
    /// inside the window.
    pub fn seconds_until_close(&self) -> u64 {
        seconds_until_hour(self.end)
    }

    /// Seconds from now until the window next opens. Meaningful while
    /// outside the window.
    pub fn seconds_until_open(&self) -> u64 {
        seconds_until_hour(self.start)
    }
}

fn parse_hour(s: &str) -> Option<u8> {
    match s.trim().parse::<u8>() {
        Ok(h) if h <= 23 => Some(h),
        _ => None,
    }
}

/// Current local hour, 0–23.
pub fn local_hour() -> u8 {
    Local::now().hour() as u8
}

/// Seconds from now until the next local `hour:00:00`. Always in
/// `(0, 86400]` so callers never busy-loop on a zero sleep.
fn seconds_until_hour(hour: u8) -> u64 {
    let now = Local::now();
    let secs_into_day = now.hour() as i64 * 3600 + now.minute() as i64 * 60 + now.second() as i64;
    let target = hour as i64 * 3600;
    let mut delta = target - secs_into_day;
    if delta <= 0 {
        delta += 24 * 3600;
    }
    delta as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_windows() {
        assert!(ServeWindow::new(8, 8).is_none()); // empty
        assert!(ServeWindow::new(24, 8).is_none()); // out of range
        assert!(ServeWindow::new(0, 25).is_none());
        assert!(ServeWindow::new(0, 24).is_none());
    }

    #[test]
    fn daytime_window_no_wrap() {
        let w = ServeWindow::new(9, 17).unwrap();
        assert!(!w.contains(8));
        assert!(w.contains(9));
        assert!(w.contains(16));
        assert!(!w.contains(17)); // end is exclusive
        assert!(!w.contains(23));
    }

    #[test]
    fn overnight_window_wraps_midnight() {
        let w = ServeWindow::new(22, 8).unwrap(); // 10pm → 8am
        assert!(w.contains(22));
        assert!(w.contains(23));
        assert!(w.contains(0));
        assert!(w.contains(7));
        assert!(!w.contains(8)); // exclusive
        assert!(!w.contains(12));
        assert!(!w.contains(21));
    }

    #[test]
    fn parse_hour_bounds() {
        assert_eq!(parse_hour(" 0 "), Some(0));
        assert_eq!(parse_hour("23"), Some(23));
        assert_eq!(parse_hour("24"), None);
        assert_eq!(parse_hour(""), None);
        assert_eq!(parse_hour("x"), None);
    }
}
