//! End-to-end test for the device-pair flow.
//!
//! Spins up a tiny axum-free HTTP server in the same process as the
//! test that mimics the cocore console's three pair endpoints, then
//! drives the agent's `start_pair` / `poll_pair` against it. This is
//! the integration-level proof that the wire shape between provider
//! and console matches.

use cocore_provider::oauth::{poll_pair, start_pair, OauthError, Session};
use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[derive(Default)]
struct PairState {
    device_id: Option<String>,
    user_code: Option<String>,
    approved_session: Option<Session>,
    denied: bool,
}

#[tokio::test]
async fn happy_path_start_then_poll() {
    let state = Arc::new(Mutex::new(PairState::default()));
    let (base_url, _server) = start_stub_console(state.clone()).await;

    // 1. Agent starts a pair flow.
    let r = start_pair(&base_url).await.expect("start_pair");
    assert_eq!(r.user_code.len(), 8);

    // 2. Browser approves out-of-band (we simulate by directly
    //    stamping a session onto the state).
    state.lock().unwrap().approved_session = Some(Session {
        did: "did:plc:test".into(),
        handle: "alice.example".into(),
        api_key: "cocore-test-key".into(),
        api_base: "https://console.example".into(),
    });

    // 3. Agent polls and gets the session.
    let s = poll_pair(&base_url, &r.device_id).await.expect("poll_pair");
    assert_eq!(s.did, "did:plc:test");
    assert_eq!(s.handle, "alice.example");
}

#[tokio::test]
async fn denied_pair_returns_denied_error() {
    let state = Arc::new(Mutex::new(PairState::default()));
    let (base_url, _server) = start_stub_console(state.clone()).await;
    let r = start_pair(&base_url).await.unwrap();
    state.lock().unwrap().denied = true;
    let err = poll_pair(&base_url, &r.device_id).await.unwrap_err();
    assert!(matches!(err, OauthError::Denied));
}

/// A handwritten stub server. Implements three endpoints:
///   POST /api/xrpc/dev.cocore.devicePair.start -> {deviceId, userCode, ...}
///   GET  /api/xrpc/dev.cocore.devicePair.poll?deviceId=... -> status payload
async fn start_stub_console(
    state: Arc<Mutex<PairState>>,
) -> (String, tokio::task::JoinHandle<Infallible>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let base = format!("http://127.0.0.1:{port}");
    let handle = tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            let state = state.clone();
            tokio::spawn(async move {
                let _ = handle_conn(&mut sock, state).await;
            });
        }
    });
    (base, handle)
}

async fn handle_conn(
    sock: &mut tokio::net::TcpStream,
    state: Arc<Mutex<PairState>>,
) -> std::io::Result<()> {
    let mut buf = vec![0u8; 8192];
    let n = sock.read(&mut buf).await?;
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let line = req.lines().next().unwrap_or("");
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");

    let (status, body) = match (method, path) {
        ("POST", "/api/xrpc/dev.cocore.devicePair.start") => {
            let mut st = state.lock().unwrap();
            st.device_id = Some("dev123".into());
            st.user_code = Some("ABCD2345".into());
            (
                "200 OK",
                serde_json::json!({
                    "deviceId": "dev123",
                    "userCode": "ABCD2345",
                    "verificationUri": "http://stub/devices/new?code=ABCD2345",
                    "pollIntervalSecs": 1,
                    "expiresInSecs": 600
                })
                .to_string(),
            )
        }
        ("GET", p) if p.starts_with("/api/xrpc/dev.cocore.devicePair.poll") => {
            let st = state.lock().unwrap();
            if st.denied {
                (
                    "403 Forbidden",
                    serde_json::json!({"status":"denied"}).to_string(),
                )
            } else if let Some(session) = st.approved_session.clone() {
                (
                    "200 OK",
                    serde_json::json!({
                        "status": "session",
                        "session": session
                    })
                    .to_string(),
                )
            } else {
                (
                    "200 OK",
                    serde_json::json!({"status":"pending"}).to_string(),
                )
            }
        }
        _ => ("404 Not Found", "{}".into()),
    };

    let resp = format!(
        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    sock.write_all(resp.as_bytes()).await?;
    sock.shutdown().await.ok();
    Ok(())
}
