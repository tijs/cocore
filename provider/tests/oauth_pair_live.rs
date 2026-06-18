//! Integration test that talks to a real cocore console.
//!
//! Skipped unless COCORE_CONSOLE_URL is set. Used by `make e2e` to
//! verify the agent <-> console wire format end-to-end.
//!
//! Usage:
//!   cd packages/console && PORT=3001 aube run vite dev --host 127.0.0.1 &
//!   COCORE_CONSOLE_URL=http://localhost:3001 cargo test \
//!     --test oauth_pair_live -- --ignored

use cocore_provider::oauth::{poll_pair, start_pair};

#[tokio::test]
#[ignore]
async fn live_console_round_trip() {
    let base = std::env::var("COCORE_CONSOLE_URL")
        .expect("COCORE_CONSOLE_URL not set; this test is intentionally ignored by default");

    let r = start_pair(&base).await.expect("start_pair");
    eprintln!("deviceId={} userCode={}", r.device_id, r.user_code);
    eprintln!("  approve at {}", r.verification_uri);

    // Approve the pair via the same HTTP API that the browser uses,
    // so this test is a black-box check of the wire surface.
    let session = serde_json::json!({
        "did": "did:plc:rs-live",
        "handle": "rs-live.example",
        "pdsEndpoint": "http://localhost:2583",
        "accessToken": "rs-live-tok",
        "refreshToken": "rs-live-ref",
        "dpopJwkPrivate": {"kty":"EC","crv":"P-256","d":"rs"},
        "expiresAt": chrono::Utc::now().to_rfc3339(),
    });
    let confirm = reqwest::Client::new()
        .post(format!("{}/api/xrpc/dev.cocore.devicePair.confirm", base))
        .json(&serde_json::json!({
            "userCode": r.user_code,
            "decision": "approve",
            "session": session,
        }))
        .send()
        .await
        .unwrap();
    assert!(
        confirm.status().is_success(),
        "confirm failed: {}",
        confirm.status()
    );

    let s = poll_pair(&base, &r.device_id).await.expect("poll_pair");
    assert_eq!(s.did, "did:plc:rs-live");
    assert_eq!(s.handle, "rs-live.example");
}
