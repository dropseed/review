//! Web Push — the VAPID identity this instance signs with, the browser
//! subscriptions registered against it, and delivery to all of them.
//!
//! State lives at `<central root>/push.json`, written the way the work queue is
//! written (see [`crate::work::storage`]): a version envelope checked on save,
//! a per-writer temp file, and a rename, so the app and a CLI writing at once
//! either both land or one is told to retry.
//!
//! The VAPID keypair is an **identity, not a secret to rotate**. Every stored
//! subscription was minted by a browser against one public key and is
//! meaningless under another, so the pair is generated once — on the first ask
//! for the public key — and never rewritten.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use base64::Engine as _;
use jwt_simple::algorithms::{ECDSAP256PublicKeyLike, ES256KeyPair};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use web_push::{
    ContentEncoding, SubscriptionInfo, Urgency, VapidSignatureBuilder, WebPushMessageBuilder,
};

use crate::review::central;
use crate::review::state::now_iso8601;

/// The alphabet every value in `push.json` and on the wire uses — what a
/// browser's `applicationServerKey` and `pushSubscription.keys` are already in.
const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::URL_SAFE_NO_PAD;

/// How long a push service holds an undelivered notification. An hour: what
/// this app has to say is about what is happening now, and a notification that
/// arrives tomorrow is noise.
const TTL_SECONDS: u32 = 3600;

/// RFC 8292's `sub` claim — who to contact about this application server.
/// Optional in the spec and required in practice; FCM rejects a VAPID
/// signature without one.
const VAPID_SUBJECT: &str = "https://github.com/dropseed/review";

/// How long one endpoint gets before it counts as a failure. Deliveries are
/// serial, so this also bounds `send_to_all`.
const SEND_TIMEOUT: Duration = Duration::from_secs(10);

const MAX_SAVE_RETRIES: usize = 5;

/// Upper bound on stored subscriptions; see `subscribe` for why one exists.
const MAX_SUBSCRIPTIONS: usize = 20;

#[derive(Error, Debug)]
pub enum PushError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Central storage error: {0}")]
    Central(#[from] central::CentralError),
    #[error("Version conflict: expected version {expected}, found {found}. Another process modified the push state.")]
    VersionConflict { expected: u64, found: u64 },
    #[error("Failed to save push state after repeated version conflicts.")]
    Contended,
}

/// A browser's `PushSubscription`, as `pushSubscription.toJSON()` spells it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushSubscription {
    pub endpoint: String,
    pub keys: PushKeys,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushKeys {
    /// The client's public key. Base64url, no padding.
    pub p256dh: String,
    /// The client's auth secret. Base64url, no padding.
    pub auth: String,
}

/// One subscription as stored: what the browser handed over, plus what we
/// noticed about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSubscription {
    #[serde(flatten)]
    subscription: PushSubscription,
    created_at: String,
    #[serde(default)]
    user_agent: Option<String>,
}

/// This instance's VAPID keypair, in the two encodings its two consumers want.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VapidKeypair {
    /// The raw P-256 scalar, base64url — exactly what
    /// [`VapidSignatureBuilder::from_base64_no_sub`] consumes, so nothing has
    /// to re-encode it on the way to a signature.
    private_key: String,
    /// The uncompressed 65-byte point, base64url — what a browser wants as
    /// `applicationServerKey`.
    public_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushState {
    #[serde(default)]
    version: u64,
    #[serde(default)]
    vapid: Option<VapidKeypair>,
    #[serde(default)]
    subscriptions: Vec<StoredSubscription>,
}

/// What the service worker receives, verbatim.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPayload {
    pub title: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
}

/// The outcome of one [`send_to_all`]. `pruned` endpoints are gone, not failed:
/// the push service said the subscription no longer exists. `subscriptions`
/// is how many were registered going in, so a caller can tell "nobody to send
/// to" from "everyone failed" without a second read of the file.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendReport {
    #[serde(default)]
    pub subscriptions: usize,
    pub sent: usize,
    pub failed: usize,
    pub pruned: usize,
}

fn push_path() -> Result<PathBuf, PushError> {
    Ok(central::get_central_root()?.join("push.json"))
}

fn load() -> Result<PushState, PushError> {
    let path = push_path()?;
    if !path.exists() {
        return Ok(PushState::default());
    }
    Ok(serde_json::from_str(&fs::read_to_string(&path)?)?)
}

/// Save with optimistic concurrency control: `state.version` is the version
/// being written, so the on-disk version must be `state.version - 1`.
fn save(state: &PushState) -> Result<(), PushError> {
    let path = push_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    if path.exists() && state.version > 0 {
        let existing: PushState = serde_json::from_str(&fs::read_to_string(&path)?)?;
        let expected = state.version - 1;
        if existing.version != expected {
            return Err(PushError::VersionConflict {
                expected,
                found: existing.version,
            });
        }
    }

    let tmp = temp_path(&path);
    let write = fs::write(&tmp, serde_json::to_string_pretty(state)?)
        .and_then(|()| fs::rename(&tmp, &path));
    if let Err(err) = write {
        let _ = fs::remove_file(&tmp);
        return Err(err.into());
    }
    Ok(())
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A scratch path for one save, distinct from every other save's, beside the
/// target so the rename stays on one filesystem. See
/// [`crate::work::storage`]'s `temp_path` for why a shared name is a bug.
fn temp_path(path: &Path) -> PathBuf {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    path.with_extension(format!("json.tmp.{}.{n}", std::process::id()))
}

/// Read-modify-write, retried when another writer lands first. `apply` returns
/// its value and whether it changed anything; an unchanged state is not
/// written, so a no-op call never bumps the version or conflicts with anyone.
fn mutate<T, F>(apply: F) -> Result<(PushState, T), PushError>
where
    F: Fn(&mut PushState) -> (T, bool),
{
    for _ in 0..MAX_SAVE_RETRIES {
        let mut state = load()?;
        let (value, changed) = apply(&mut state);
        if !changed {
            return Ok((state, value));
        }
        state.version += 1;
        match save(&state) {
            Ok(()) => return Ok((state, value)),
            Err(PushError::VersionConflict { .. }) => {}
            Err(e) => return Err(e),
        }
    }
    Err(PushError::Contended)
}

/// This instance's VAPID public key, base64url — the `applicationServerKey` a
/// browser subscribes with. Generates and persists the keypair on first call
/// and returns the same one forever after.
pub fn public_key() -> anyhow::Result<String> {
    let (state, ()) = mutate(|state| {
        if state.vapid.is_some() {
            return ((), false);
        }
        let pair = ES256KeyPair::generate();
        state.vapid = Some(VapidKeypair {
            private_key: B64.encode(pair.to_bytes()),
            public_key: B64.encode(pair.public_key().public_key().to_bytes_uncompressed()),
        });
        ((), true)
    })?;
    // `mutate` either found a keypair or wrote one.
    Ok(state
        .vapid
        .expect("a keypair was just generated if none existed")
        .public_key)
}

/// Register a subscription, replacing any earlier one for the same endpoint —
/// a browser re-subscribing hands back the same endpoint with fresh keys.
///
/// A page re-registers on every load, so an identical repeat writes nothing: it
/// keeps the version still and the file watcher quiet.
pub fn subscribe(sub: PushSubscription, user_agent: Option<String>) -> anyhow::Result<()> {
    let incoming = StoredSubscription {
        subscription: sub,
        created_at: now_iso8601(),
        user_agent,
    };
    mutate(|state| {
        let mut entry = incoming.clone();
        if let Some(existing) = state
            .subscriptions
            .iter()
            .find(|s| s.subscription.endpoint == entry.subscription.endpoint)
        {
            // The same endpoint is the same registration, however long ago it
            // first arrived.
            entry.created_at.clone_from(&existing.created_at);
            if entry == *existing {
                return ((), false);
            }
        }
        state
            .subscriptions
            .retain(|s| s.subscription.endpoint != entry.subscription.endpoint);
        // A person has a handful of devices; an unbounded list is only ever
        // someone (or something) feeding this endpoint junk, and every entry
        // is an outbound request on every send. Oldest out first.
        while state.subscriptions.len() >= MAX_SUBSCRIPTIONS {
            state.subscriptions.remove(0);
        }
        state.subscriptions.push(entry);
        ((), true)
    })?;
    Ok(())
}

/// Forget a subscription. An endpoint nothing has registered is not an error —
/// a browser unsubscribing twice has said the same true thing twice.
pub fn unsubscribe(endpoint: &str) -> anyhow::Result<()> {
    mutate(|state| {
        let before = state.subscriptions.len();
        state
            .subscriptions
            .retain(|s| s.subscription.endpoint != endpoint);
        ((), state.subscriptions.len() != before)
    })?;
    Ok(())
}

pub fn subscription_count() -> anyhow::Result<usize> {
    Ok(load()?.subscriptions.len())
}

/// Deliver `payload` to every registered subscription.
///
/// Endpoints the push service reports as gone (404/410) are dropped from
/// storage — the browser that owned them will never see them again. Every
/// other failure is counted and left alone, because a push service being down
/// is not a subscription being dead.
pub async fn send_to_all(payload: &NotificationPayload) -> anyhow::Result<SendReport> {
    let state = load()?;
    let mut report = SendReport {
        subscriptions: state.subscriptions.len(),
        ..SendReport::default()
    };
    let Some(vapid) = state.vapid.as_ref() else {
        // No keypair means nobody could have subscribed against one.
        return Ok(report);
    };
    if state.subscriptions.is_empty() {
        return Ok(report);
    }

    let signer = VapidSignatureBuilder::from_base64_no_sub(&vapid.private_key)
        .map_err(|e| anyhow::anyhow!("invalid stored VAPID key: {e}"))?;
    let body = serde_json::to_vec(payload)?;
    let client = reqwest::Client::builder().timeout(SEND_TIMEOUT).build()?;

    let mut dead = Vec::new();

    for stored in &state.subscriptions {
        let info = SubscriptionInfo::new(
            stored.subscription.endpoint.clone(),
            stored.subscription.keys.p256dh.clone(),
            stored.subscription.keys.auth.clone(),
        );

        let message = {
            let mut vapid_builder = signer.clone().add_sub_info(&info);
            vapid_builder.add_claim("sub", VAPID_SUBJECT);
            let signature = match vapid_builder.build() {
                Ok(signature) => signature,
                Err(e) => {
                    log::warn!("[push] could not sign for {}: {e}", info.endpoint);
                    report.failed += 1;
                    continue;
                }
            };
            let mut builder = WebPushMessageBuilder::new(&info);
            builder.set_ttl(TTL_SECONDS);
            builder.set_urgency(Urgency::High);
            builder.set_payload(ContentEncoding::Aes128Gcm, &body);
            builder.set_vapid_signature(signature);
            match builder.build() {
                Ok(message) => message,
                Err(e) => {
                    log::warn!("[push] could not encrypt for {}: {e}", info.endpoint);
                    report.failed += 1;
                    continue;
                }
            }
        };

        let mut request = client
            .post(message.endpoint.to_string())
            .header("TTL", message.ttl.to_string());
        if let Some(urgency) = message.urgency {
            request = request.header("Urgency", urgency.to_string());
        }
        if let Some(encrypted) = message.payload {
            request = request
                .header("Content-Type", "application/octet-stream")
                .header("Content-Encoding", encrypted.content_encoding.to_str());
            for (name, value) in encrypted.crypto_headers {
                request = request.header(name, value);
            }
            request = request.body(encrypted.content);
        }

        match request.send().await {
            Ok(response) if response.status().is_success() => report.sent += 1,
            Ok(response) if matches!(response.status().as_u16(), 404 | 410) => {
                dead.push(stored.subscription.endpoint.clone());
            }
            Ok(response) => {
                log::warn!(
                    "[push] {} rejected the notification: {}",
                    stored.subscription.endpoint,
                    response.status()
                );
                report.failed += 1;
            }
            Err(e) => {
                log::warn!("[push] {} unreachable: {e}", stored.subscription.endpoint);
                report.failed += 1;
            }
        }
    }

    if !dead.is_empty() {
        let (_, removed) = mutate(|state| {
            let before = state.subscriptions.len();
            state
                .subscriptions
                .retain(|s| !dead.contains(&s.subscription.endpoint));
            let removed = before - state.subscriptions.len();
            (removed, removed > 0)
        })?;
        report.pruned = removed;
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::{setup_test, ENV_LOCK};

    fn sub(endpoint: &str, p256dh: &str) -> PushSubscription {
        PushSubscription {
            endpoint: endpoint.to_owned(),
            keys: PushKeys {
                p256dh: p256dh.to_owned(),
                auth: "xS03Fi5ErfTNH_l9WHE9Ig".to_owned(),
            },
        }
    }

    #[test]
    fn the_keypair_is_generated_once_and_then_stands() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let first = public_key().unwrap();
        let second = public_key().unwrap();
        assert_eq!(first, second);
        // Uncompressed P-256 point: 65 bytes, leading 0x04.
        let raw = B64.decode(&first).unwrap();
        assert_eq!(raw.len(), 65);
        assert_eq!(raw[0], 4);
        // Reading it back must not have rewritten anything.
        assert_eq!(load().unwrap().version, 1);
    }

    #[test]
    fn the_stored_private_key_is_what_the_signer_consumes() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let public = public_key().unwrap();
        let private = load().unwrap().vapid.unwrap().private_key;
        let signer = VapidSignatureBuilder::from_base64_no_sub(&private).unwrap();
        assert_eq!(B64.encode(signer.get_public_key()), public);
    }

    #[test]
    fn subscribe_upserts_by_endpoint_and_unsubscribe_removes() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        subscribe(
            sub("https://push.example/a", "key-a"),
            Some("Safari".into()),
        )
        .unwrap();
        subscribe(sub("https://push.example/b", "key-b"), None).unwrap();
        assert_eq!(subscription_count().unwrap(), 2);

        subscribe(
            sub("https://push.example/a", "key-a2"),
            Some("Chrome".into()),
        )
        .unwrap();
        assert_eq!(subscription_count().unwrap(), 2);

        let state = load().unwrap();
        let a = state
            .subscriptions
            .iter()
            .find(|s| s.subscription.endpoint == "https://push.example/a")
            .unwrap();
        assert_eq!(a.subscription.keys.p256dh, "key-a2");
        assert_eq!(a.user_agent.as_deref(), Some("Chrome"));

        // A page re-registering the same thing must not churn the file.
        let version = load().unwrap().version;
        subscribe(
            sub("https://push.example/a", "key-a2"),
            Some("Chrome".into()),
        )
        .unwrap();
        assert_eq!(load().unwrap().version, version);

        unsubscribe("https://push.example/a").unwrap();
        assert_eq!(subscription_count().unwrap(), 1);
        // Removing something already gone is not an error and writes nothing.
        let version = load().unwrap().version;
        unsubscribe("https://push.example/a").unwrap();
        assert_eq!(load().unwrap().version, version);
    }

    #[test]
    fn mutate_retries_over_a_concurrent_write() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        subscribe(sub("https://push.example/a", "key-a"), None).unwrap();

        // Another process wins the race on the first pass: our save conflicts,
        // and `mutate` reloads and reapplies on top of their version.
        let interfered = std::cell::Cell::new(false);
        let (state, ()) = mutate(|state| {
            if !interfered.get() {
                interfered.set(true);
                let mut theirs = load().unwrap();
                theirs.subscriptions.push(StoredSubscription {
                    subscription: sub("https://push.example/theirs", "key-t"),
                    created_at: now_iso8601(),
                    user_agent: None,
                });
                theirs.version += 1;
                save(&theirs).unwrap();
            }
            state.subscriptions.push(StoredSubscription {
                subscription: sub("https://push.example/ours", "key-o"),
                created_at: now_iso8601(),
                user_agent: None,
            });
            ((), true)
        })
        .unwrap();

        assert!(interfered.get());
        let endpoints: Vec<_> = state
            .subscriptions
            .iter()
            .map(|s| s.subscription.endpoint.as_str())
            .collect();
        assert_eq!(
            endpoints,
            [
                "https://push.example/a",
                "https://push.example/theirs",
                "https://push.example/ours"
            ]
        );
    }

    #[test]
    fn a_stale_version_is_refused() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        subscribe(sub("https://push.example/a", "key-a"), None).unwrap();
        let stale = PushState {
            version: 1,
            ..PushState::default()
        };
        assert!(matches!(
            save(&stale),
            Err(PushError::VersionConflict { .. })
        ));
    }

    #[test]
    fn the_payload_the_service_worker_sees_is_camel_case() {
        let payload = NotificationPayload {
            title: "Review".into(),
            body: "Test notification".into(),
            url: Some("/".into()),
            tag: None,
        };
        assert_eq!(
            serde_json::to_string(&payload).unwrap(),
            r#"{"title":"Review","body":"Test notification","url":"/"}"#
        );
    }

    #[test]
    fn stored_subscriptions_round_trip_as_camel_case() {
        let stored = StoredSubscription {
            subscription: sub("https://push.example/a", "key-a"),
            created_at: "2026-08-17T00:00:00Z".into(),
            user_agent: Some("Safari".into()),
        };
        let json: serde_json::Value = serde_json::to_value(&stored).unwrap();
        assert_eq!(json["endpoint"], "https://push.example/a");
        assert_eq!(json["keys"]["p256dh"], "key-a");
        assert_eq!(json["createdAt"], "2026-08-17T00:00:00Z");
        assert_eq!(json["userAgent"], "Safari");
    }

    /// Driven on a runtime built here rather than by `#[tokio::test]`, because
    /// `$REVIEW_HOME` has to stay this test's for the whole send — which means
    /// holding `ENV_LOCK` across the await.
    #[test]
    fn sending_with_nothing_registered_reports_nothing() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();

        let report = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(send_to_all(&NotificationPayload {
                title: "Review".into(),
                body: "Test notification".into(),
                url: None,
                tag: None,
            }))
            .unwrap();
        assert_eq!((report.sent, report.failed, report.pruned), (0, 0, 0));
    }
}
