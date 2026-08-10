//! GitHub provider abstraction.
//!
//! Defines a trait for interacting with GitHub pull requests and a concrete
//! implementation backed by the `gh` CLI.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Command, Output};
use std::time::Duration;

use crate::process::output_with_timeout;

// ---------------------------------------------------------------------------
// Running gh
// ---------------------------------------------------------------------------

/// `gh auth status` only talks to one endpoint; anything slower than this is a
/// network that isn't going to answer.
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
/// Listing or querying can be a real request against a large account.
const QUERY_TIMEOUT: Duration = Duration::from_secs(45);

/// Run a `gh` command under a deadline, mapping both "never came back" and
/// "couldn't start" onto [`GhError`] so callers have one thing to handle.
///
/// Every `gh` call goes through here. `gh` talks to the network, and a request
/// that never returns would otherwise hold its caller — a refresh, a freshness
/// poll — open forever.
fn gh_output(cmd: &mut Command, timeout: Duration, what: &str) -> Result<Output, GhError> {
    match output_with_timeout(cmd, timeout) {
        Ok(Some(output)) => Ok(output),
        Ok(None) => Err(GhError::Timeout(format!(
            "{what} timed out after {}s",
            timeout.as_secs()
        ))),
        Err(e) => Err(GhError::Io(e.to_string())),
    }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Lightweight PR reference embedded in [`super::traits::Comparison`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrRef {
    pub number: u32,
    pub title: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// Full pull request returned by listing endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u32,
    pub title: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub url: String,
    pub author: PrAuthor,
    pub state: String,
    #[serde(default)]
    pub is_draft: bool,
    pub updated_at: String,
    #[serde(default)]
    pub body: String,
}

/// Author of a pull request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrAuthor {
    pub login: String,
}

// ---------------------------------------------------------------------------
// Trait
// ---------------------------------------------------------------------------

/// Abstraction over GitHub operations so the `gh` CLI can be swapped for
/// direct API calls later.
pub trait GitHubProvider {
    type Error: std::error::Error;

    /// Returns `true` when the provider is installed and authenticated.
    fn is_available(&self) -> bool;

    /// List open pull requests for the repository.
    fn list_pull_requests(&self) -> Result<Vec<PullRequest>, Self::Error>;
}

// ---------------------------------------------------------------------------
// GhCliProvider
// ---------------------------------------------------------------------------

/// [`GitHubProvider`] backed by the `gh` CLI.
pub struct GhCliProvider {
    repo_path: PathBuf,
}

impl GhCliProvider {
    pub fn new(repo_path: PathBuf) -> Self {
        Self { repo_path }
    }
}

impl GitHubProvider for GhCliProvider {
    type Error = GhError;

    fn is_available(&self) -> bool {
        let mut cmd = Command::new("gh");
        cmd.args(["auth", "status"]).current_dir(&self.repo_path);
        gh_output(&mut cmd, AUTH_TIMEOUT, "gh auth status")
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn list_pull_requests(&self) -> Result<Vec<PullRequest>, GhError> {
        let mut cmd = Command::new("gh");
        cmd.args([
            "pr",
            "list",
            "--json",
            "number,title,headRefName,baseRefName,url,author,state,isDraft,updatedAt,body",
        ])
        .current_dir(&self.repo_path);
        let output = gh_output(&mut cmd, QUERY_TIMEOUT, "gh pr list")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GhError::Command(stderr.into_owned()));
        }

        let prs: Vec<PullRequest> =
            serde_json::from_slice(&output.stdout).map_err(|e| GhError::Parse(e.to_string()))?;
        Ok(prs)
    }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum GhError {
    Io(String),
    Command(String),
    Parse(String),
    /// The command was still running at its deadline and got killed.
    Timeout(String),
}

impl std::fmt::Display for GhError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(msg) => write!(f, "gh I/O error: {msg}"),
            Self::Command(msg) => write!(f, "gh command error: {msg}"),
            Self::Parse(msg) => write!(f, "gh parse error: {msg}"),
            Self::Timeout(msg) => write!(f, "gh timed out: {msg}"),
        }
    }
}

impl std::error::Error for GhError {}

// ---------------------------------------------------------------------------
// Viewer-wide open PRs
// ---------------------------------------------------------------------------

/// One open pull request authored by the authenticated user, from anywhere on
/// GitHub — not scoped to a repository the way [`PullRequest`] is.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerPr {
    pub number: u32,
    pub title: String,
    pub url: String,
    pub is_draft: bool,
    pub updated_at: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    /// `owner/name` of the *base* repo — where the PR is open — as GitHub
    /// spells it. This is the repo the PR belongs to for display purposes.
    pub repo_name_with_owner: String,
    pub repo_url: String,
    /// `owner/name` of the repo the head branch lives in, which differs from
    /// [`Self::repo_name_with_owner`] for a PR opened from a fork. `None` when
    /// the head repo has been deleted. This is what the local join keys on: the
    /// head repo is the one whose branch a checkout would have.
    #[serde(default)]
    pub head_repo_name_with_owner: Option<String>,
    /// `APPROVED` | `CHANGES_REQUESTED` | `REVIEW_REQUIRED`, or `None` when no
    /// review has been asked for.
    pub review_decision: Option<String>,
    /// Rolled-up CI state (`SUCCESS` | `FAILURE` | `PENDING` | `ERROR` |
    /// `EXPECTED`), or `None` when the head commit has no checks at all.
    pub checks_state: Option<String>,
    /// Local path of the registered repo this PR belongs to, filled in by the
    /// join in [`crate::service::viewer_prs`]. `None` means the PR lives in a
    /// repo Review doesn't know about locally.
    #[serde(default)]
    pub repo_path: Option<String>,
}

/// One page of 100 — GitHub's per-connection maximum. `totalCount` is what
/// tells a caller there was more than that.
const VIEWER_PRS_QUERY: &str = r"
query {
  viewer {
    pullRequests(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      totalCount
      nodes {
        number title isDraft url updatedAt reviewDecision headRefName baseRefName
        repository { nameWithOwner url }
        headRepository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}
";

/// What `gh auth status` had to say, in the three shapes callers care about.
///
/// The distinction that matters is [`Self::Unusable`] versus everything else:
/// it is the only answer that means "this user doesn't have GitHub tooling",
/// which is a reason to hide the feature rather than to warn about it. A
/// timeout is not that — `gh` is installed, it just didn't answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GhAuth {
    Authenticated,
    /// `gh` is missing, or installed and logged out.
    Unusable(String),
    /// `gh` is there but overran its deadline, so its state is unknown.
    Timeout(String),
}

/// Whether the `gh` CLI is installed and authenticated for github.com, asked
/// without a repository to stand in. [`GitHubProvider::is_available`] answers
/// the same question from inside a repo; the viewer query has none.
///
/// Scoped to github.com on purpose: bare `gh auth status` reports on *every*
/// configured host and fails if any of them does, so one unreachable GHES
/// instance would otherwise report github.com as logged out — after waiting out
/// its 30-second timeout.
pub fn gh_auth_status() -> GhAuth {
    let mut cmd = Command::new("gh");
    cmd.args(["auth", "status", "--hostname", "github.com"]);
    match gh_output(&mut cmd, AUTH_TIMEOUT, "gh auth status") {
        Ok(output) if output.status.success() => GhAuth::Authenticated,
        Ok(_) => GhAuth::Unusable("GitHub CLI is not authenticated for github.com".to_owned()),
        Err(GhError::Timeout(msg)) => GhAuth::Timeout(msg),
        Err(e) => GhAuth::Unusable(e.to_string()),
    }
}

/// Every open PR the authenticated user has out, newest first, plus whether
/// GitHub had more than one page of them.
///
/// Account-wide, so this is a free function rather than a [`GhCliProvider`]
/// method — there is no repository for it to run in.
pub fn fetch_viewer_open_prs() -> Result<(Vec<ViewerPr>, bool), GhError> {
    let mut cmd = Command::new("gh");
    cmd.args(["api", "graphql", "-f"])
        .arg(format!("query={VIEWER_PRS_QUERY}"));
    let output = gh_output(&mut cmd, QUERY_TIMEOUT, "the open-PR query")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GhError::Command(stderr.into_owned()));
    }

    parse_viewer_prs(&output.stdout)
}

// The GraphQL response shape, mirrored just deeply enough to flatten it. Kept
// private: `ViewerPr` is the type the rest of the app sees.
#[derive(Deserialize)]
struct ViewerPrsResponse {
    data: Option<ViewerPrsData>,
    #[serde(default)]
    errors: Vec<GraphQlError>,
}

#[derive(Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Deserialize)]
struct ViewerPrsData {
    viewer: ViewerNode,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerNode {
    pull_requests: PullRequestConnection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullRequestConnection {
    total_count: usize,
    nodes: Vec<ViewerPrNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerPrNode {
    number: u32,
    title: String,
    is_draft: bool,
    url: String,
    updated_at: String,
    review_decision: Option<String>,
    head_ref_name: String,
    base_ref_name: String,
    repository: RepositoryNode,
    /// Null once the fork the PR came from is deleted.
    #[serde(default)]
    head_repository: Option<HeadRepositoryNode>,
    commits: CommitConnection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryNode {
    name_with_owner: String,
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeadRepositoryNode {
    name_with_owner: String,
}

#[derive(Deserialize)]
struct CommitConnection {
    nodes: Vec<CommitNode>,
}

#[derive(Deserialize)]
struct CommitNode {
    commit: Commit,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Commit {
    /// Null when the commit has no checks — a repo without CI, or a push that
    /// hasn't triggered anything yet.
    status_check_rollup: Option<StatusCheckRollup>,
}

#[derive(Deserialize)]
struct StatusCheckRollup {
    state: String,
}

/// Flatten a `gh api graphql` viewer response into [`ViewerPr`]s. Split out
/// from [`fetch_viewer_open_prs`] so the shape can be tested off a fixture.
fn parse_viewer_prs(body: &[u8]) -> Result<(Vec<ViewerPr>, bool), GhError> {
    let response: ViewerPrsResponse =
        serde_json::from_slice(body).map_err(|e| GhError::Parse(e.to_string()))?;

    let Some(data) = response.data else {
        let message = response
            .errors
            .into_iter()
            .map(|e| e.message)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(GhError::Command(if message.is_empty() {
            "GraphQL response had no data".to_owned()
        } else {
            message
        }));
    };

    let connection = data.viewer.pull_requests;
    let truncated = connection.total_count > connection.nodes.len();
    let prs = connection
        .nodes
        .into_iter()
        .map(|node| ViewerPr {
            number: node.number,
            title: node.title,
            url: node.url,
            is_draft: node.is_draft,
            updated_at: node.updated_at,
            head_ref_name: node.head_ref_name,
            base_ref_name: node.base_ref_name,
            repo_name_with_owner: node.repository.name_with_owner,
            repo_url: node.repository.url,
            head_repo_name_with_owner: node.head_repository.map(|r| r.name_with_owner),
            review_decision: node.review_decision,
            checks_state: node
                .commits
                .nodes
                .into_iter()
                .next()
                .and_then(|c| c.commit.status_check_rollup)
                .map(|rollup| rollup.state),
            repo_path: None,
        })
        .collect();

    Ok((prs, truncated))
}

// ---------------------------------------------------------------------------
// PR status (for freshness checks)
// ---------------------------------------------------------------------------

/// Lightweight PR status for freshness checks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatus {
    pub state: String,        // OPEN, MERGED, CLOSED
    pub head_ref_oid: String, // SHA of the PR head commit
}

impl GhCliProvider {
    /// Get the current status (state + head SHA) of a pull request.
    pub fn get_pr_status(&self, number: u32) -> Result<PrStatus, GhError> {
        let mut cmd = Command::new("gh");
        cmd.args([
            "pr",
            "view",
            &number.to_string(),
            "--json",
            "state,headRefOid",
        ])
        .current_dir(&self.repo_path);
        let output = gh_output(&mut cmd, QUERY_TIMEOUT, "gh pr view")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GhError::Command(stderr.into_owned()));
        }

        let status: PrStatus =
            serde_json::from_slice(&output.stdout).map_err(|e| GhError::Parse(e.to_string()))?;
        Ok(status)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed from a real `gh api graphql` response: one PR with CI, one
    /// without (and opened from a fork), and a `totalCount` larger than the
    /// page.
    const VIEWER_PRS_FIXTURE: &str = r#"{
      "data": {
        "viewer": {
          "pullRequests": {
            "totalCount": 53,
            "nodes": [
              {
                "number": 97,
                "title": "Upgrade ty and fix the typing bugs it newly catches",
                "isDraft": true,
                "url": "https://github.com/dropseed/plain/pull/97",
                "updatedAt": "2026-08-10T15:06:30Z",
                "reviewDecision": "CHANGES_REQUESTED",
                "headRefName": "claude/funny-mendel-dpl351",
                "baseRefName": "master",
                "repository": {
                  "nameWithOwner": "dropseed/plain",
                  "url": "https://github.com/dropseed/plain"
                },
                "headRepository": { "nameWithOwner": "dropseed/plain" },
                "commits": {
                  "nodes": [{ "commit": { "statusCheckRollup": { "state": "SUCCESS" } } }]
                }
              },
              {
                "number": 29,
                "title": "Say when a repo is dirty, not when git last moved",
                "isDraft": false,
                "url": "https://github.com/dropseed/review/pull/29",
                "updatedAt": "2026-08-01T16:10:34Z",
                "reviewDecision": null,
                "headRefName": "claude/git-status-sidebar-reliability-4jlhjx",
                "baseRefName": "master",
                "repository": {
                  "nameWithOwner": "dropseed/review",
                  "url": "https://github.com/dropseed/review"
                },
                "headRepository": { "nameWithOwner": "davegaeddert/review" },
                "commits": { "nodes": [{ "commit": { "statusCheckRollup": null } }] }
              }
            ]
          }
        }
      }
    }"#;

    #[test]
    fn parses_viewer_prs_and_flattens_the_check_rollup() {
        let (prs, truncated) = parse_viewer_prs(VIEWER_PRS_FIXTURE.as_bytes()).unwrap();

        assert!(truncated, "53 open PRs don't fit in a page of 2");
        assert_eq!(prs.len(), 2);

        let first = &prs[0];
        assert_eq!(first.number, 97);
        assert_eq!(first.repo_name_with_owner, "dropseed/plain");
        assert_eq!(first.head_ref_name, "claude/funny-mendel-dpl351");
        assert!(first.is_draft);
        assert_eq!(first.review_decision.as_deref(), Some("CHANGES_REQUESTED"));
        assert_eq!(first.checks_state.as_deref(), Some("SUCCESS"));
        assert_eq!(
            first.repo_path, None,
            "the join fills this in, not the parse"
        );
        assert_eq!(
            first.head_repo_name_with_owner.as_deref(),
            Some("dropseed/plain")
        );

        // A repo without CI reports no state rather than a fabricated one.
        assert_eq!(prs[1].checks_state, None);
        assert_eq!(prs[1].review_decision, None);
        assert!(!prs[1].is_draft);
        // A fork PR: base and head repos are different, and the join needs the
        // head one to find the clone that actually has the branch.
        assert_eq!(prs[1].repo_name_with_owner, "dropseed/review");
        assert_eq!(
            prs[1].head_repo_name_with_owner.as_deref(),
            Some("davegaeddert/review")
        );
    }

    /// GitHub returns `headRepository: null` once the fork a PR came from is
    /// deleted. That has to parse, not blow up the whole page of PRs.
    #[test]
    fn a_deleted_head_repo_parses_as_no_head_repo() {
        let body = r#"{"data":{"viewer":{"pullRequests":{"totalCount":1,"nodes":[{
          "number": 5, "title": "Orphan", "isDraft": false,
          "url": "https://github.com/dropseed/review/pull/5",
          "updatedAt": "2026-08-01T16:10:34Z", "reviewDecision": null,
          "headRefName": "gone", "baseRefName": "master",
          "repository": { "nameWithOwner": "dropseed/review", "url": "https://github.com/dropseed/review" },
          "headRepository": null,
          "commits": { "nodes": [] }
        }]}}}}"#;
        let (prs, _) = parse_viewer_prs(body.as_bytes()).unwrap();
        assert_eq!(prs[0].head_repo_name_with_owner, None);
        assert_eq!(prs[0].checks_state, None);
    }

    #[test]
    fn a_full_page_that_is_the_whole_list_is_not_truncated() {
        let body = r#"{"data":{"viewer":{"pullRequests":{"totalCount":0,"nodes":[]}}}}"#;
        let (prs, truncated) = parse_viewer_prs(body.as_bytes()).unwrap();
        assert!(prs.is_empty());
        assert!(!truncated);
    }

    /// A GraphQL error arrives with HTTP 200 and no data — it has to read as a
    /// failure, not as "you have no open PRs".
    #[test]
    fn graphql_errors_surface_as_errors() {
        let body = r#"{"data":null,"errors":[{"message":"Bad credentials"}]}"#;
        let err = parse_viewer_prs(body.as_bytes()).unwrap_err();
        assert!(
            err.to_string().contains("Bad credentials"),
            "unexpected error: {err}"
        );
    }
}
