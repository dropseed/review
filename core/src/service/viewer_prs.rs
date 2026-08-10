//! The user's open GitHub PRs, joined to the repos Review has registered.
//!
//! One account-wide query answers "what work do I have outstanding?" for every
//! repo at once, which is what makes this cheap enough to poll. The join is
//! what turns an account-wide list into something the sidebar can place: a PR
//! whose repo is registered locally gets a `repo_path` and belongs on a row; one
//! that doesn't is still worth showing, just elsewhere.
//!
//! The snapshot is cached on disk so a launch can paint PRs before `gh` has
//! answered — and so a failed refresh can keep showing the last good answer
//! *next to* the error, rather than an empty list that reads as "nothing to do".
//! An empty sidebar has to mean empty.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::review::central;
use crate::review::state::{iso8601_from_system_time, now_iso8601};
use crate::sources::github::{self, ViewerPr};
use crate::sources::local_git;

/// Last known state of the user's open PRs.
///
/// `error` and `prs` are deliberately independent: an errored snapshot still
/// carries whatever was last fetched, along with the `fetched_at` that data
/// actually came from, so the UI can say "stale, and here's why".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerPrSnapshot {
    /// ISO 8601 time the `prs` were fetched. The Unix epoch means "never".
    pub fetched_at: String,
    pub prs: Vec<ViewerPr>,
    /// GitHub had more open PRs than the query's page of 100.
    #[serde(default)]
    pub truncated: bool,
    /// Why the last refresh failed, if it did. `prs` is then the previous
    /// snapshot's data, which may be empty.
    #[serde(default)]
    pub error: Option<String>,
}

impl ViewerPrSnapshot {
    /// The "nothing fetched yet" snapshot: no PRs, and honestly dated so a
    /// caller can tell it apart from a genuinely empty account.
    fn never_fetched() -> Self {
        Self {
            fetched_at: iso8601_from_system_time(std::time::SystemTime::UNIX_EPOCH),
            prs: Vec::new(),
            truncated: false,
            error: None,
        }
    }
}

/// Disk cache, next to the repo index under `~/.review/` (or `$REVIEW_HOME`).
const CACHE_FILE: &str = "viewer_prs.json";

/// The user's open PRs, from disk or from GitHub.
///
/// `refresh == false` never touches the network — it is the instant-on-launch
/// path, and returns the cached snapshot at whatever age it has.
///
/// `refresh == true` queries GitHub and replaces the cache on success. On
/// failure the previous snapshot comes back with `error` set: stale data with an
/// honest error beats no data.
pub fn get_viewer_prs(refresh: bool) -> ViewerPrSnapshot {
    let cached = load_cached_snapshot();
    if !refresh {
        return cached.unwrap_or_else(ViewerPrSnapshot::never_fetched);
    }

    match fetch_and_join() {
        Ok(snapshot) => {
            if let Err(e) = save_snapshot(&snapshot) {
                log::warn!("[viewer_prs] failed to cache snapshot: {e}");
            }
            snapshot
        }
        Err(error) => {
            log::warn!("[viewer_prs] refresh failed: {error}");
            let mut previous = cached.unwrap_or_else(ViewerPrSnapshot::never_fetched);
            previous.error = Some(error);
            previous
        }
    }
}

/// Fetch from GitHub and stamp each PR with the local repo it belongs to.
fn fetch_and_join() -> Result<ViewerPrSnapshot, String> {
    // Asked first because it's the common failure and `gh`'s own error for it
    // is a wall of setup instructions.
    if !github::is_gh_authenticated() {
        return Err("GitHub CLI not available/authenticated".to_owned());
    }

    let (mut prs, truncated) = github::fetch_viewer_open_prs().map_err(|e| e.to_string())?;
    join_registered_repos(&mut prs);

    Ok(ViewerPrSnapshot {
        fetched_at: now_iso8601(),
        prs,
        truncated,
        error: None,
    })
}

/// Stamp each PR with the path of the registered repo it lives in, when there
/// is one.
fn join_registered_repos(prs: &mut [ViewerPr]) {
    let by_slug = registered_repos_by_slug();
    for pr in prs {
        pr.repo_path = by_slug
            .get(&pr.repo_name_with_owner.to_lowercase())
            .cloned();
    }
}

/// Map `owner/name` (lowercased) to the local path of the registered repo whose
/// `origin` points at it.
///
/// Repos the registry still lists but that are gone from disk are skipped, as
/// are repos with no `origin` and remotes on any host but github.com. On a
/// duplicate slug the most recently accessed repo wins — `list_registered_repos`
/// hands them back in that order.
fn registered_repos_by_slug() -> HashMap<String, String> {
    let repos = match central::list_registered_repos() {
        Ok(repos) => repos,
        Err(e) => {
            log::warn!("[viewer_prs] could not read the repo index: {e}");
            return HashMap::new();
        }
    };

    let mut by_slug = HashMap::new();
    for repo in repos {
        if !Path::new(&repo.path).is_dir() {
            continue;
        }
        let Some(slug) = origin_url(&repo.path).as_deref().and_then(github_slug) else {
            continue;
        };
        by_slug.entry(slug).or_insert(repo.path);
    }
    by_slug
}

/// The repo's `origin` URL, or `None` when it has no origin (or isn't a repo
/// anymore).
fn origin_url(repo_path: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", repo_path, "remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// `owner/name`, lowercased for comparison, for a remote hosted on github.com.
/// `None` for any other host — an `owner/name` that collides across hosts must
/// not join to the wrong repo.
fn github_slug(remote_url: &str) -> Option<String> {
    let (host, path) = local_git::split_remote_url(remote_url)?;
    host.eq_ignore_ascii_case("github.com")
        .then(|| path.to_lowercase())
}

fn cache_path() -> Option<PathBuf> {
    central::get_central_root()
        .ok()
        .map(|root| root.join(CACHE_FILE))
}

/// The last snapshot written to disk. A cache that can't be read or parsed is
/// simply absent — it's disposable data.
fn load_cached_snapshot() -> Option<ViewerPrSnapshot> {
    let content = fs::read_to_string(cache_path()?).ok()?;
    match serde_json::from_str::<ViewerPrSnapshot>(&content) {
        Ok(mut snapshot) => {
            // Only good fetches are ever written, but a stale error in the file
            // would be a lie about *this* read.
            snapshot.error = None;
            Some(snapshot)
        }
        Err(e) => {
            log::warn!("[viewer_prs] ignoring unreadable cache: {e}");
            None
        }
    }
}

/// Write the snapshot atomically (tmp + rename), like the repo index.
fn save_snapshot(snapshot: &ViewerPrSnapshot) -> anyhow::Result<()> {
    let root = central::get_central_root()?;
    fs::create_dir_all(&root)?;
    let tmp_path = root.join(format!("{CACHE_FILE}.tmp"));
    fs::write(&tmp_path, serde_json::to_string_pretty(snapshot)?)?;
    fs::rename(&tmp_path, root.join(CACHE_FILE))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::{setup_test, ENV_LOCK};

    #[test]
    fn github_slug_accepts_every_form_git_hands_out() {
        for url in [
            "git@github.com:dropseed/review.git",
            "https://github.com/dropseed/review.git",
            "https://github.com/dropseed/review",
            "ssh://git@github.com/dropseed/review.git",
            // Case is GitHub's business, not ours — the join compares lowercased.
            "https://github.com/DropSeed/Review",
        ] {
            assert_eq!(
                github_slug(url).as_deref(),
                Some("dropseed/review"),
                "failed on {url}"
            );
        }
    }

    #[test]
    fn github_slug_rejects_other_hosts_and_junk() {
        for url in [
            "git@gitlab.com:dropseed/review.git",
            "https://bitbucket.org/dropseed/review.git",
            "/srv/git/review.git",
            "",
        ] {
            assert_eq!(github_slug(url), None, "should not match: {url}");
        }
    }

    #[test]
    fn an_unfetched_snapshot_is_empty_and_dated_at_the_epoch() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, _repo_dir) = setup_test();

        let snapshot = get_viewer_prs(false);
        assert!(snapshot.prs.is_empty());
        assert!(!snapshot.truncated);
        assert_eq!(
            snapshot.error, None,
            "never having fetched is not an error — an empty sidebar must be trustworthy"
        );
        assert!(
            snapshot.fetched_at.starts_with("1970-01-01"),
            "unexpected fetched_at: {}",
            snapshot.fetched_at
        );
    }

    #[test]
    fn a_saved_snapshot_reads_back_off_disk() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, _repo_dir) = setup_test();

        let saved = ViewerPrSnapshot {
            fetched_at: "2026-08-10T15:06:30.000Z".to_owned(),
            prs: vec![ViewerPr {
                number: 97,
                title: "Upgrade ty".to_owned(),
                url: "https://github.com/dropseed/plain/pull/97".to_owned(),
                is_draft: true,
                updated_at: "2026-08-10T15:06:30Z".to_owned(),
                head_ref_name: "claude/funny-mendel".to_owned(),
                base_ref_name: "master".to_owned(),
                repo_name_with_owner: "dropseed/plain".to_owned(),
                repo_url: "https://github.com/dropseed/plain".to_owned(),
                review_decision: None,
                checks_state: Some("SUCCESS".to_owned()),
                repo_path: Some("/repos/plain".to_owned()),
            }],
            truncated: true,
            error: None,
        };
        save_snapshot(&saved).unwrap();

        let loaded = get_viewer_prs(false);
        assert_eq!(loaded.fetched_at, saved.fetched_at);
        assert!(loaded.truncated);
        assert_eq!(loaded.error, None);
        assert_eq!(loaded.prs.len(), 1);
        assert_eq!(loaded.prs[0].number, 97);
        assert_eq!(loaded.prs[0].checks_state.as_deref(), Some("SUCCESS"));
        assert_eq!(loaded.prs[0].repo_path.as_deref(), Some("/repos/plain"));
    }

    /// The join reads the registry, so a repo that is registered but whose
    /// origin isn't on GitHub contributes nothing — and never claims a PR.
    #[test]
    fn the_join_ignores_repos_without_a_github_origin() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, repo_dir) = setup_test();
        central::register_repo(repo_dir.path()).unwrap();

        let mut prs = vec![ViewerPr {
            number: 1,
            title: "Something".to_owned(),
            url: "https://github.com/someone/elsewhere/pull/1".to_owned(),
            is_draft: false,
            updated_at: "2026-08-10T15:06:30Z".to_owned(),
            head_ref_name: "topic".to_owned(),
            base_ref_name: "main".to_owned(),
            repo_name_with_owner: "someone/elsewhere".to_owned(),
            repo_url: "https://github.com/someone/elsewhere".to_owned(),
            review_decision: None,
            checks_state: None,
            repo_path: Some("/stale/path".to_owned()),
        }];
        join_registered_repos(&mut prs);

        assert_eq!(
            prs[0].repo_path, None,
            "an unmatched PR must be cleared, not left carrying a stale path"
        );
    }
}
