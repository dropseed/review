//! The user's open GitHub PRs, joined to the repos Review has registered.
//!
//! One account-wide query answers "what work do I have outstanding?" for every
//! repo at once, which is what makes this cheap enough to poll. The join is
//! what turns an account-wide list into something the sidebar can place: a PR
//! whose *head* repo is registered locally gets a `repo_path` and belongs on a
//! row; one that doesn't is still worth showing, just elsewhere.
//!
//! The snapshot is cached on disk so a launch can paint PRs before `gh` has
//! answered — and so a failed refresh can keep showing the last good answer
//! *next to* the error, rather than an empty list that reads as "nothing to do".
//! An empty sidebar has to mean empty.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, TryLockError};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::process::output_with_timeout;
use crate::review::central;
use crate::review::state::{iso8601_from_system_time, now_iso8601};
use crate::sources::github::{self, GhAuth, ViewerPr};
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
    /// Whether GitHub tooling is usable on this machine at all.
    ///
    /// `false` means `gh` is missing or logged out — this user doesn't do
    /// GitHub from here, so the feature has nothing to say and the UI shows
    /// nothing rather than a warning they can't act on. `error` still carries
    /// the reason for debugging. Every other outcome, including a query that
    /// failed or timed out, is `true`: something is wrong and worth saying.
    ///
    /// **`available == false` means ignore `prs`.** The field is set on the
    /// failure path, which hands back the last cached snapshot so `error` stays
    /// debuggable and a re-auth restores instantly — so `prs` is whatever was
    /// last fetched, not an empty list. Rendering it would paint PR rows for a
    /// user who has deliberately been told nothing is wrong.
    #[serde(default = "available_by_default")]
    pub available: bool,
}

/// Cached snapshots predate this field, and are only ever written after a
/// successful fetch — which means `gh` worked.
fn available_by_default() -> bool {
    true
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
            available: true,
        }
    }
}

/// Why a refresh didn't produce a snapshot, and whether `gh` itself is the
/// reason. Carried separately from the message because the two lead to
/// different UI: a missing `gh` hides the feature, a failed query warns.
struct FetchFailure {
    message: String,
    gh_available: bool,
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
    if !refresh {
        return cached_or_empty();
    }

    // One `gh` fetch at a time, however many windows ask. The loser waits for
    // the winner and then reads what it wrote, rather than firing a second
    // query at the same account-wide data.
    match REFRESH_LOCK.try_lock() {
        Ok(_guard) => refresh_now(),
        Err(TryLockError::WouldBlock) => {
            let _guard = REFRESH_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            cached_or_empty()
        }
        // A panic mid-refresh left nothing but a lock to clean up; the cache is
        // written atomically or not at all.
        Err(TryLockError::Poisoned(poisoned)) => {
            let _guard = poisoned.into_inner();
            refresh_now()
        }
    }
}

/// Serializes refreshes within the process. See [`get_viewer_prs`].
static REFRESH_LOCK: Mutex<()> = Mutex::new(());

fn cached_or_empty() -> ViewerPrSnapshot {
    load_cached_snapshot().unwrap_or_else(ViewerPrSnapshot::never_fetched)
}

/// Query GitHub, cache the result, and fall back to the last good snapshot when
/// the query fails. Called with [`REFRESH_LOCK`] held.
fn refresh_now() -> ViewerPrSnapshot {
    match fetch_and_join() {
        Ok(snapshot) => {
            if let Err(e) = save_snapshot(&snapshot) {
                log::warn!("[viewer_prs] failed to cache snapshot: {e}");
            }
            snapshot
        }
        Err(failure) => {
            log::warn!("[viewer_prs] refresh failed: {}", failure.message);
            let mut previous = cached_or_empty();
            previous.error = Some(failure.message);
            previous.available = failure.gh_available;
            previous
        }
    }
}

/// Fetch from GitHub and stamp each PR with the local repo it belongs to.
fn fetch_and_join() -> Result<ViewerPrSnapshot, FetchFailure> {
    // Straight to the query. `gh auth status` answers one thing the query's own
    // error doesn't — whether `gh` is usable at all — but asking it first spent
    // a second `gh` spawn on every refresh, the path that always runs, to
    // pre-empt a failure that mostly doesn't happen. It is asked on failure now.
    let (mut prs, truncated) = github::fetch_viewer_open_prs()
        .map_err(|e| classify_failure(&e, github::gh_auth_status()))?;
    join_registered_repos(&mut prs);

    Ok(ViewerPrSnapshot {
        fetched_at: now_iso8601(),
        prs,
        truncated,
        error: None,
        available: true,
    })
}

/// What a failed viewer query means, given what `gh auth status` says about the
/// CLI itself. Pure, so the mapping is testable without a `gh` on the machine.
fn classify_failure(error: &github::GhError, auth: GhAuth) -> FetchFailure {
    match auth {
        // The one answer that means "this user doesn't do GitHub from here",
        // which hides the feature. `gh`'s own logged-out message is a wall of
        // setup instructions and says far more than the query's error, so it is
        // the one carried.
        GhAuth::Unusable(message) => FetchFailure {
            message,
            gh_available: false,
        },
        // Authenticated, or too slow to say. Either way `gh` is there, so the
        // query failing is something to warn about rather than to hide.
        GhAuth::Authenticated | GhAuth::Timeout(_) => FetchFailure {
            message: error.to_string(),
            gh_available: true,
        },
    }
}

/// Stamp each PR with the path of the registered repo it lives in, when there
/// is one.
///
/// The key is the **head** repo, never the base: the local clone that matters
/// is the one holding the branch the PR is proposing. A PR opened from a fork
/// Review doesn't have registered is not locally actionable even when the base
/// repo is registered — it gets no `repo_path` and shows up under "elsewhere"
/// rather than badging a branch that isn't the PR's.
fn join_registered_repos(prs: &mut [ViewerPr]) {
    let by_slug = registered_repos_by_slug();
    for pr in prs {
        pr.repo_path = pr
            .head_repo_name_with_owner
            .as_ref()
            .and_then(|slug| by_slug.get(&slug.to_lowercase()))
            .cloned();
    }
}

/// Map `owner/name` (lowercased) to the local path of a registered repo with a
/// remote pointing at it.
///
/// *Every* GitHub remote counts, not just `origin`: a fork clone has
/// `origin = me/x` and `upstream = org/x`, and PRs land under either slug
/// depending on who opened them. Repos the registry still lists but that are
/// gone from disk are skipped, as are remotes on any host but github.com. On a
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
        for slug in github_slugs(&repo.path) {
            by_slug.entry(slug).or_insert_with(|| repo.path.clone());
        }
    }
    by_slug
}

/// A repo's remotes shouldn't take long, but the join runs one subprocess per
/// registered repo and a wedged filesystem shouldn't stall the whole refresh.
const GIT_CONFIG_TIMEOUT: Duration = Duration::from_secs(10);

/// The GitHub slugs of every remote configured in `repo_path`, lowercased.
///
/// One `git config` call rather than one per remote: the whole point is to be
/// cheap enough to run across every registered repo on each refresh.
fn github_slugs(repo_path: &str) -> Vec<String> {
    let mut cmd = Command::new("git");
    cmd.args([
        "-C",
        repo_path,
        "config",
        "--get-regexp",
        r"^remote\..*\.url$",
    ]);
    // A repo with no remotes exits non-zero, which is not worth logging.
    let Ok(Some(output)) = output_with_timeout(&mut cmd, GIT_CONFIG_TIMEOUT) else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    // Each line is `remote.<name>.url <value>`.
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split_once(' '))
        .filter_map(|(_key, url)| github_slug(url.trim()))
        .collect()
}

/// `owner/name`, lowercased for comparison, for a remote hosted on github.com.
/// `None` for any other host — an `owner/name` that collides across hosts must
/// not join to the wrong repo.
///
/// `ssh.github.com` counts: it's the same GitHub, reached over port 443 by
/// people whose network blocks 22.
fn github_slug(remote_url: &str) -> Option<String> {
    let (host, path) = local_git::split_remote_url(remote_url)?;
    (host.eq_ignore_ascii_case("github.com") || host.eq_ignore_ascii_case("ssh.github.com"))
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
            // The join that filled these in ran whenever this file was written,
            // and repos get deleted. A path that isn't there anymore would put
            // a row in the sidebar for a repo that no longer exists.
            for pr in &mut snapshot.prs {
                if pr
                    .repo_path
                    .as_deref()
                    .is_some_and(|p| !Path::new(p).is_dir())
                {
                    pr.repo_path = None;
                }
            }
            Some(snapshot)
        }
        Err(e) => {
            log::warn!("[viewer_prs] ignoring unreadable cache: {e}");
            None
        }
    }
}

/// Distinguishes tmp files written by this process from each other; the pid
/// distinguishes them from other processes'.
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write the snapshot atomically (tmp + rename), like the repo index.
///
/// The tmp name is unique per writer: two Review windows refreshing at once
/// would otherwise write the same tmp path and rename each other's half-written
/// bytes into place.
fn save_snapshot(snapshot: &ViewerPrSnapshot) -> anyhow::Result<()> {
    let root = central::get_central_root()?;
    fs::create_dir_all(&root)?;
    let tmp_path = root.join(format!(
        "{CACHE_FILE}.tmp.{}.{}",
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&tmp_path, serde_json::to_string_pretty(snapshot)?)?;
    if let Err(e) = fs::rename(&tmp_path, root.join(CACHE_FILE)) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e.into());
    }
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
            // SSH over 443, for networks that block 22. Same GitHub.
            "ssh://git@ssh.github.com:443/dropseed/review.git",
            "ssh://git@github.com:22/dropseed/review.git",
        ] {
            assert_eq!(
                github_slug(url).as_deref(),
                Some("dropseed/review"),
                "failed on {url}"
            );
        }
    }

    /// `available` is what decides between hiding the feature and warning about
    /// it, and the query now runs before the auth check that sets it. Only a
    /// `gh` that is missing or logged out may turn it off.
    #[test]
    fn only_an_unusable_gh_makes_the_feature_unavailable() {
        let error = github::GhError::Command("HTTP 502".to_owned());

        let logged_out = classify_failure(
            &error,
            GhAuth::Unusable("gh: not logged in to github.com".to_owned()),
        );
        assert!(!logged_out.gh_available);
        assert_eq!(
            logged_out.message, "gh: not logged in to github.com",
            "gh's own setup message says more than the query's error"
        );

        let query_broke = classify_failure(&error, GhAuth::Authenticated);
        assert!(
            query_broke.gh_available,
            "a query failure on a working gh is worth warning about, not hiding"
        );
        assert!(query_broke.message.contains("HTTP 502"));

        // An auth check too slow to answer proves nothing against `gh`, and
        // must not be read as "no GitHub tooling here".
        let unknown = classify_failure(&error, GhAuth::Timeout("timed out".to_owned()));
        assert!(unknown.gh_available);
        assert!(unknown.message.contains("HTTP 502"));
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

    /// A PR open against `base`, proposed from `head` (`None` = deleted fork),
    /// already carrying a stale `repo_path` the join has to overwrite.
    fn pr(number: u32, base: &str, head: Option<&str>) -> ViewerPr {
        ViewerPr {
            number,
            title: format!("PR {number}"),
            url: format!("https://github.com/{base}/pull/{number}"),
            is_draft: false,
            updated_at: "2026-08-10T15:06:30Z".to_owned(),
            head_ref_name: "topic".to_owned(),
            base_ref_name: "main".to_owned(),
            repo_name_with_owner: base.to_owned(),
            repo_url: format!("https://github.com/{base}"),
            head_repo_name_with_owner: head.map(str::to_owned),
            review_decision: None,
            checks_state: None,
            repo_path: Some("/stale/path".to_owned()),
        }
    }

    fn git(repo: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(["-C", &repo.to_string_lossy()])
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn a_saved_snapshot_reads_back_off_disk() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, repo_dir) = setup_test();
        let repo_path = repo_dir.path().to_string_lossy().into_owned();

        let mut only = pr(97, "dropseed/plain", Some("dropseed/plain"));
        only.checks_state = Some("SUCCESS".to_owned());
        only.repo_path = Some(repo_path.clone());
        let saved = ViewerPrSnapshot {
            fetched_at: "2026-08-10T15:06:30.000Z".to_owned(),
            prs: vec![only],
            truncated: true,
            error: None,
            available: true,
        };
        save_snapshot(&saved).unwrap();

        let loaded = get_viewer_prs(false);
        assert_eq!(loaded.fetched_at, saved.fetched_at);
        assert!(loaded.truncated);
        assert_eq!(loaded.error, None);
        assert!(loaded.available);
        assert_eq!(loaded.prs.len(), 1);
        assert_eq!(loaded.prs[0].number, 97);
        assert_eq!(loaded.prs[0].checks_state.as_deref(), Some("SUCCESS"));
        assert_eq!(loaded.prs[0].repo_path.as_deref(), Some(repo_path.as_str()));
    }

    /// A repo can be deleted between refreshes. Reading a path out of the cache
    /// that no longer exists would put a row in the sidebar for a repo that is
    /// gone — offline, where no fetch will ever correct it.
    #[test]
    fn the_cache_drops_repo_paths_that_no_longer_exist() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, _repo_dir) = setup_test();

        let mut gone = pr(1, "dropseed/review", Some("dropseed/review"));
        gone.repo_path = Some("/repos/deleted-last-week".to_owned());
        save_snapshot(&ViewerPrSnapshot {
            fetched_at: "2026-08-10T15:06:30.000Z".to_owned(),
            prs: vec![gone],
            truncated: false,
            error: None,
            available: true,
        })
        .unwrap();

        let loaded = get_viewer_prs(false);
        assert_eq!(
            loaded.prs[0].repo_path, None,
            "a cached path to a deleted repo must not resurrect it"
        );
    }

    /// Snapshots written before `available` existed were only ever written
    /// after a successful fetch, so they must not read back as "no gh".
    #[test]
    fn a_cache_without_the_available_field_reads_as_available() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, _repo_dir) = setup_test();

        let root = central::get_central_root().unwrap();
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join(CACHE_FILE),
            r#"{"fetchedAt":"2026-08-10T15:06:30.000Z","prs":[],"truncated":false}"#,
        )
        .unwrap();

        assert!(get_viewer_prs(false).available);
    }

    /// The join reads the registry, so a repo that is registered but whose
    /// remotes aren't on GitHub contributes nothing — and never claims a PR.
    #[test]
    fn the_join_ignores_repos_without_a_github_remote() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, repo_dir) = setup_test();
        git(repo_dir.path(), &["init"]);
        git(
            repo_dir.path(),
            &[
                "remote",
                "add",
                "origin",
                "git@gitlab.com:someone/elsewhere.git",
            ],
        );
        central::register_repo(repo_dir.path()).unwrap();

        let mut prs = vec![pr(1, "someone/elsewhere", Some("someone/elsewhere"))];
        join_registered_repos(&mut prs);

        assert_eq!(
            prs[0].repo_path, None,
            "an unmatched PR must be cleared, not left carrying a stale path"
        );
    }

    /// A fork clone has `origin = me/x` and `upstream = org/x`, and PRs arrive
    /// under either slug. Both have to find the one local checkout.
    #[test]
    fn the_join_matches_any_github_remote_not_just_origin() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, repo_dir) = setup_test();
        git(repo_dir.path(), &["init"]);
        git(
            repo_dir.path(),
            &[
                "remote",
                "add",
                "origin",
                "git@github.com:davegaeddert/review.git",
            ],
        );
        git(
            repo_dir.path(),
            &[
                "remote",
                "add",
                "upstream",
                "https://github.com/dropseed/review.git",
            ],
        );
        central::register_repo(repo_dir.path()).unwrap();
        let registered = central::list_registered_repos().unwrap()[0].path.clone();

        let mut prs = vec![
            pr(1, "dropseed/review", Some("davegaeddert/review")),
            pr(2, "dropseed/review", Some("dropseed/review")),
        ];
        join_registered_repos(&mut prs);

        assert_eq!(prs[0].repo_path.as_deref(), Some(registered.as_str()));
        assert_eq!(prs[1].repo_path.as_deref(), Some(registered.as_str()));
    }

    /// The join keys on the head repo alone. Someone else's fork PR against a
    /// repo we do have registered is not locally actionable — badging our
    /// checkout with it would point at a branch that isn't the PR's.
    #[test]
    fn the_join_keys_on_the_head_repo_and_never_falls_back_to_the_base() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, repo_dir) = setup_test();
        git(repo_dir.path(), &["init"]);
        git(
            repo_dir.path(),
            &[
                "remote",
                "add",
                "origin",
                "git@github.com:dropseed/review.git",
            ],
        );
        central::register_repo(repo_dir.path()).unwrap();
        let registered = central::list_registered_repos().unwrap()[0].path.clone();

        let mut prs = vec![
            pr(1, "dropseed/review", Some("dropseed/review")),
            pr(2, "dropseed/review", Some("stranger/review")),
            pr(3, "dropseed/review", None),
        ];
        join_registered_repos(&mut prs);

        assert_eq!(prs[0].repo_path.as_deref(), Some(registered.as_str()));
        assert_eq!(
            prs[1].repo_path, None,
            "a fork we don't have registered belongs elsewhere, not on our row"
        );
        assert_eq!(
            prs[2].repo_path, None,
            "a deleted head repo can't be joined to anything"
        );
    }

    /// The registry outlives the directories it lists, and the fetch path is
    /// the one that runs when a repo was deleted while the app was closed.
    #[test]
    fn the_join_skips_registered_repos_that_are_gone_from_disk() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, repo_dir) = setup_test();
        git(repo_dir.path(), &["init"]);
        git(
            repo_dir.path(),
            &[
                "remote",
                "add",
                "origin",
                "git@github.com:dropseed/review.git",
            ],
        );
        central::register_repo(repo_dir.path()).unwrap();
        fs::remove_dir_all(repo_dir.path()).unwrap();

        let mut prs = vec![pr(1, "dropseed/review", Some("dropseed/review"))];
        join_registered_repos(&mut prs);

        assert_eq!(prs[0].repo_path, None);
    }
}
