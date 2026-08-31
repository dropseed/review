//! Shipped pull requests — the one PR fact the open-PR snapshot cannot carry.
//!
//! [`crate::service::viewer_prs`] asks GitHub for `states: OPEN`, so a PR that
//! merges does not change in the snapshot: it vanishes from it. That is enough
//! for a sidebar that only ever drew open PRs, and not enough for a queue whose
//! story ends in *shipped* — the workspace has to say "this landed" rather than
//! quietly losing its badge.
//!
//! So the refresh that noticed a PR leave the open set asks here, and this asks
//! `gh` once per departure. The answer is kept because a merged or closed PR
//! stays that way: the cache is not a freshness trick, it is the only reason a
//! merge survives the refresh that discovered it. Without it, "shipped" would
//! last exactly as long as one snapshot diff.
//!
//! An **open** answer is deliberately never kept — that is a snapshot which had
//! simply not caught up, and keeping it would freeze the PR as unshipped for
//! good. `gh` missing or unauthenticated means no answer at all, which the UI
//! shows as nothing new. Never a guess: "shipped" is a claim about the world.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::home;
use crate::review::state::now_iso8601;
use crate::sources::github::{GhCliProvider, PrOutcome, ViewerPr};

const CACHE_FILE: &str = "shipped_prs.json";

/// How many merges the snapshot carries, newest first.
///
/// A cap rather than an age cutoff: the list exists so a workspace card can
/// find *its* claim in it, and the workspaces that still exist are few. Long
/// enough that a week of merges is all there, short enough that the file and
/// the snapshot stay small.
const KEEP: usize = 50;

/// A pull request that landed, as a workspace card wants to say it.
///
/// Carries the claim it belongs to — repo path and head branch — because that
/// is how the frontend finds it: the workspace holds a claim, not a PR number.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShippedPr {
    pub number: u32,
    pub url: String,
    pub title: String,
    /// ISO 8601, straight from GitHub.
    pub merged_at: String,
    /// The local repo the branch lives in, as attachments spell it.
    pub repo_path: String,
    pub head_ref_name: String,
    /// When Review confirmed the merge — what the newest-first cap sorts by.
    /// Distinct from `merged_at`, which can be much older than the moment this
    /// machine first went looking.
    pub confirmed_at: String,
}

/// One settled PR as the cache stores it: the outcome, plus what it takes to
/// rebuild a [`ShippedPr`] without asking GitHub again.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settled {
    /// MERGED or CLOSED. Closed-without-merging is kept too — not to show, but
    /// so the same PR is never asked about twice.
    state: String,
    #[serde(default)]
    merged_at: Option<String>,
    url: String,
    title: String,
    repo_path: String,
    head_ref_name: String,
    confirmed_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Cache {
    /// Keyed `<repo-id>#<number>`.
    #[serde(default)]
    outcomes: HashMap<String, Settled>,
}

/// The most departures one refresh will ask GitHub about.
///
/// Each unsettled departure is a `gh pr view` with a 45-second timeout, run
/// serially while the viewer-PR refresh lock is held — so the bound is not a
/// nicety, it is what stops a pathological diff between two snapshots (a
/// re-auth, an account with different visibility, a query that half-failed)
/// from turning one refresh into minutes of blocked `gh` calls. Real merges
/// arrive a handful at a time; anything past this is caught on later refreshes,
/// because a PR stays departed.
const MAX_PER_REFRESH: usize = 10;

/// Ask about every PR that has left the open set, and record what became of it.
///
/// Called by the refresh that spotted the departures, with the ones it has a
/// local repo for — a PR in a repo this machine doesn't have registered has no
/// claim to attach to and nothing to ask `gh` from. PRs already settled cost
/// nothing; the rest cost one `gh pr view` each, up to [`MAX_PER_REFRESH`].
pub fn record_departed(departed: &[ViewerPr]) {
    let mut asked = 0;
    for pr in departed {
        if asked >= MAX_PER_REFRESH {
            log::warn!(
                "[shipped] {} departures this refresh; asking about {MAX_PER_REFRESH} and \
                 leaving the rest for the next one",
                departed.len()
            );
            break;
        }
        let Some(repo_path) = pr.repo_path.as_deref() else {
            continue;
        };
        let Some(key) = cache_key(repo_path, pr.number) else {
            continue;
        };
        if cached(&key).is_some() {
            continue;
        }
        // Counted here, not at the top of the loop: the cap is on `gh` calls,
        // and a departure that is already settled or has no local repo costs
        // nothing. Otherwise a run of known merges would use up the budget and
        // starve the one PR this refresh actually had to ask about.
        asked += 1;
        let Ok(outcome) = GhCliProvider::new(PathBuf::from(repo_path)).get_pr_outcome(pr.number)
        else {
            continue;
        };
        if !outcome.is_settled() {
            continue;
        }
        remember(key, settled_from(pr, repo_path, &outcome));
    }
}

/// The merges worth showing, newest confirmation first, capped at [`KEEP`].
pub fn recent_shipped() -> Vec<ShippedPr> {
    let Ok(mut guard) = CACHE.lock() else {
        return Vec::new();
    };
    let cache = guard.get_or_insert_with(load);
    let mut shipped: Vec<ShippedPr> = cache
        .outcomes
        .iter()
        .filter_map(|(key, entry)| shipped_from(key, entry))
        .collect();
    shipped.sort_by(|a, b| b.confirmed_at.cmp(&a.confirmed_at));
    shipped.truncate(KEEP);
    shipped
}

fn settled_from(pr: &ViewerPr, repo_path: &str, outcome: &PrOutcome) -> Settled {
    Settled {
        state: outcome.state.clone(),
        merged_at: outcome.merged_at.clone(),
        // GitHub's own answer for both, rather than the departed PR's — the
        // snapshot's copy is as old as the last refresh that still saw it.
        url: outcome.url.clone(),
        title: outcome.title.clone(),
        repo_path: repo_path.to_owned(),
        head_ref_name: pr.head_ref_name.clone(),
        confirmed_at: now_iso8601(),
    }
}

fn shipped_from(key: &str, entry: &Settled) -> Option<ShippedPr> {
    if entry.state != "MERGED" {
        return None;
    }
    Some(ShippedPr {
        number: key.rsplit('#').next()?.parse().ok()?,
        url: entry.url.clone(),
        title: entry.title.clone(),
        // A merged PR always carries the timestamp; an empty string rather than
        // an `Option` because nothing downstream has a second thing to say when
        // it's missing.
        merged_at: entry.merged_at.clone().unwrap_or_default(),
        repo_path: entry.repo_path.clone(),
        head_ref_name: entry.head_ref_name.clone(),
        confirmed_at: entry.confirmed_at.clone(),
    })
}

fn cache_key(repo_path: &str, number: u32) -> Option<String> {
    Some(format!(
        "{}#{number}",
        home::compute_repo_id(std::path::Path::new(repo_path)).ok()?
    ))
}

/// The in-process copy, loaded once. Two windows can still write over each
/// other's newest entry; the loser is re-asked and re-written, which is what a
/// disposable cache is allowed to cost.
static CACHE: Mutex<Option<Cache>> = Mutex::new(None);

fn cached(key: &str) -> Option<Settled> {
    let mut guard = CACHE.lock().ok()?;
    guard.get_or_insert_with(load).outcomes.get(key).cloned()
}

fn remember(key: String, entry: Settled) {
    let Ok(mut guard) = CACHE.lock() else {
        return;
    };
    let cache = guard.get_or_insert_with(load);
    cache.outcomes.insert(key, entry);
    if let Err(e) = save(cache) {
        log::warn!("[shipped] could not write the cache: {e}");
    }
}

fn cache_path() -> Option<PathBuf> {
    home::get_central_root()
        .ok()
        .map(|root| root.join(CACHE_FILE))
}

fn load() -> Cache {
    let Some(path) = cache_path() else {
        return Cache::default();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return Cache::default();
    };
    serde_json::from_str(&content).unwrap_or_else(|e| {
        log::warn!("[shipped] ignoring unreadable cache: {e}");
        Cache::default()
    })
}

/// Distinguishes tmp files written by this process from each other; the pid
/// distinguishes them from other processes'.
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Written tmp-then-rename, like every other file directly in the central root:
/// two windows confirming different PRs at once must not leave half a file
/// behind for the next reader.
fn save(cache: &Cache) -> anyhow::Result<()> {
    let root = home::get_central_root()?;
    fs::create_dir_all(&root)?;
    let tmp_path = root.join(format!(
        "{CACHE_FILE}.tmp.{}.{}",
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&tmp_path, serde_json::to_string_pretty(cache)?)?;
    if let Err(e) = fs::rename(&tmp_path, root.join(CACHE_FILE)) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::home::tests::{setup_test, ENV_LOCK};

    fn settled(state: &str, confirmed_at: &str) -> Settled {
        Settled {
            state: state.to_owned(),
            merged_at: Some("2026-08-01T00:00:00Z".to_owned()),
            url: "https://github.com/o/r/pull/7".to_owned(),
            title: "Land it".to_owned(),
            repo_path: "/repos/r".to_owned(),
            head_ref_name: "feature".to_owned(),
            confirmed_at: confirmed_at.to_owned(),
        }
    }

    #[test]
    fn only_a_merge_is_shipped() {
        assert!(shipped_from("abc#7", &settled("CLOSED", "2026-08-02T00:00:00Z")).is_none());

        let shipped = shipped_from("abc#7", &settled("MERGED", "2026-08-02T00:00:00Z"))
            .expect("a merged PR shipped");
        // The number comes back out of the key, which is what ties the entry to
        // the claim the card will look it up by.
        assert_eq!(shipped.number, 7);
        assert_eq!(shipped.head_ref_name, "feature");
        assert_eq!(shipped.merged_at, "2026-08-01T00:00:00Z");
    }

    #[test]
    fn settled_outcomes_are_the_only_ones_worth_keeping() {
        let outcome = |state: &str| PrOutcome {
            state: state.to_owned(),
            merged_at: None,
            url: String::new(),
            title: String::new(),
        };
        assert!(outcome("MERGED").is_settled());
        assert!(outcome("CLOSED").is_settled());
        assert!(
            !outcome("OPEN").is_settled(),
            "keeping an open answer would freeze the PR as unshipped"
        );
    }

    #[test]
    fn merges_survive_a_round_trip_through_disk_newest_first() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, _repo) = setup_test();
        *CACHE.lock().unwrap() = None;

        remember(
            "abc#7".to_owned(),
            settled("MERGED", "2026-08-02T00:00:00Z"),
        );
        remember(
            "abc#9".to_owned(),
            settled("MERGED", "2026-08-03T00:00:00Z"),
        );
        remember(
            "abc#8".to_owned(),
            settled("CLOSED", "2026-08-04T00:00:00Z"),
        );

        // The next window reads the file, not this process's copy.
        *CACHE.lock().unwrap() = None;
        let shipped = recent_shipped();

        assert_eq!(
            shipped.iter().map(|s| s.number).collect::<Vec<_>>(),
            vec![9, 7],
            "newest confirmation first, and a closed PR is not shipped"
        );
        *CACHE.lock().unwrap() = None;
    }
}
