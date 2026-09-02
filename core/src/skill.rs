//! The bundled agent skill, and keeping an installed copy current.
//!
//! `spur skill install` writes [`SKILL_CONTENTS`] — embedded at build time, so
//! the shipped binary carries it — into each agent tool's skills directory.
//! The copy it leaves behind is the problem this module exists for: the next
//! release ships a new skill and the installed one keeps describing the old
//! CLI until someone re-runs the command.
//!
//! A stale skill is worse than a missing one. Without it an agent reads
//! `spur --help`; with a stale one it confidently uses flags that moved and
//! commands that were renamed, and has no way to tell. [`SUPERSEDED`] is the
//! same argument one version earlier — `review-app` had to be *deleted* on
//! upgrade because an agent reading it would drive the wrong instance.
//!
//! So the app refreshes it on launch. The one thing that must not happen is
//! overwriting something the human wrote, and the file lives in *their*
//! directory — so a refresh never guesses. Beside the skill sits
//! [`MANAGED_MARKER`], holding the digest of the content we last wrote, and
//! the comparison between it and what is on disk is the whole design:
//!
//! - digests match → untouched since we wrote it, ours to update silently
//! - digests differ → the human edited it, leave it alone and say so
//! - no marker at all → an older CLI put it there; only an explicit install
//!   adopts it, because a launch has no business claiming a file it can't
//!   prove it owns

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// The skill's directory name under each tool's `skills/`.
pub const SKILL_NAME: &str = "spur-app";

/// The skill itself, embedded so the shipped binary installs without the repo.
pub const SKILL_CONTENTS: &str = include_str!("../resources/skills/spur-app/SKILL.md");

/// Records the digest of the content we last wrote, making an unedited copy
/// safe to replace. A dotfile so it does not read as a second skill.
const MANAGED_MARKER: &str = ".spur-managed";

/// Skills earlier versions installed, now folded into [`SKILL_NAME`]. Removed
/// on install so an upgraded CLI doesn't leave overlapping skills behind.
///
/// `review-app` is this same skill under the app's old name, and leaving it in
/// place is worse than leaving a merely redundant one: every command in it
/// spells the CLI `review`, which after the rename is either absent or a stale
/// binary resolving a home Spur no longer writes to. An agent reading it would
/// drive the wrong instance.
pub const SUPERSEDED: &[&str] = &["review-app", "review-guide", "review-terminals"];

/// What a write did, so callers can report it without re-deriving it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkillWrite {
    /// Nothing was there; the skill is new.
    Installed,
    /// Ours, and the content changed.
    Updated,
    /// Ours, and already current.
    Unchanged,
    /// Was there without a marker — an older CLI's copy, now managed.
    Adopted,
    /// The digest doesn't match what we wrote: someone edited it. Left alone.
    LeftEdited,
    /// Refresh only: no installed skill to bring forward.
    NotInstalled,
}

impl SkillWrite {
    /// Whether the skill on disk changed, which is what a caller reports.
    pub fn changed(self) -> bool {
        matches!(self, Self::Installed | Self::Updated | Self::Adopted)
    }
}

/// How much authority the caller has over a file it did not write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// A person asked for this. Adopts an unmarked copy; `force` also
    /// overwrites one they edited.
    Explicit { force: bool },
    /// The app noticing a new release. Touches only what it can prove is its
    /// own, and never creates a skill nobody asked for.
    Refresh,
}

/// The tools this skill is installed for, and where each keeps its skills.
///
/// A tool whose home can't be resolved is simply absent — the two are
/// unrelated directories, and one being unavailable is not a reason to skip
/// the other.
pub fn install_roots() -> Vec<(&'static str, PathBuf)> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(("Claude Code", home.join(".claude").join("skills")));
    }
    if let Some(codex) = crate::service::util::codex_home() {
        roots.push(("Codex", codex.join("skills")));
    }
    roots
}

/// Bring every installed copy up to date. The app's launch path.
///
/// Returns what happened per tool so a caller can log it; nothing here is an
/// error worth surfacing to a human mid-launch.
pub fn refresh_all() -> Vec<(&'static str, std::io::Result<SkillWrite>)> {
    install_roots()
        .into_iter()
        .map(|(tool, root)| (tool, write_skill(&root, Mode::Refresh)))
        .collect()
}

fn digest(contents: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(contents.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Install or refresh the skill under `skills_root`, per `mode`.
pub fn write_skill(skills_root: &Path, mode: Mode) -> std::io::Result<SkillWrite> {
    let skill_dir = skills_root.join(SKILL_NAME);
    let skill_file = skill_dir.join("SKILL.md");
    let marker_file = skill_dir.join(MANAGED_MARKER);

    let on_disk = std::fs::read_to_string(&skill_file).ok();
    // A marker whose file we can't read is the same as none: it only ever
    // means "this digest is what we last wrote".
    let recorded = std::fs::read_to_string(&marker_file)
        .ok()
        .map(|s| s.trim().to_owned());

    let outcome = match (&on_disk, &recorded, mode) {
        // Nothing installed. Only a person creates a skill.
        (None, _, Mode::Refresh) => return Ok(SkillWrite::NotInstalled),
        (None, _, Mode::Explicit { .. }) => SkillWrite::Installed,

        // Installed by an older CLI, before markers existed. A launch can't
        // prove it owns this; an explicit install adopts it.
        (Some(_), None, Mode::Refresh) => return Ok(SkillWrite::NotInstalled),
        (Some(_), None, Mode::Explicit { .. }) => SkillWrite::Adopted,

        (Some(current), Some(recorded), mode) => {
            if digest(current) != *recorded {
                // Edited. `--force` is the only thing that overrides a human.
                if !matches!(mode, Mode::Explicit { force: true }) {
                    return Ok(SkillWrite::LeftEdited);
                }
                SkillWrite::Updated
            } else if current == SKILL_CONTENTS {
                // Already current. Still fall through on an explicit install,
                // which is cheap and repairs a missing or stale marker.
                if matches!(mode, Mode::Refresh) {
                    return Ok(SkillWrite::Unchanged);
                }
                SkillWrite::Unchanged
            } else {
                SkillWrite::Updated
            }
        }
    };

    std::fs::create_dir_all(&skill_dir)?;
    std::fs::write(&skill_file, SKILL_CONTENTS)?;
    // Written after the skill, never before: a marker naming content that
    // isn't on disk would make the next refresh believe an edit is ours.
    std::fs::write(&marker_file, digest(SKILL_CONTENTS))?;

    remove_superseded(skills_root);
    Ok(outcome)
}

/// Delete the skills this one replaced. Best-effort: a skill the user edited
/// or never had is not worth failing the install over, so failures are silent.
fn remove_superseded(skills_root: &Path) {
    for name in SUPERSEDED {
        let dir = skills_root.join(name);
        if dir.is_dir() && std::fs::remove_dir_all(&dir).is_ok() {
            log::info!(
                "[skill] removed the superseded {name} skill at {}",
                dir.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPLICIT: Mode = Mode::Explicit { force: false };
    const FORCED: Mode = Mode::Explicit { force: true };

    fn skill_file(root: &Path) -> PathBuf {
        root.join(SKILL_NAME).join("SKILL.md")
    }
    fn marker_file(root: &Path) -> PathBuf {
        root.join(SKILL_NAME).join(MANAGED_MARKER)
    }

    /// Stand in for "a previous release wrote this": older content, plus the
    /// marker that release would have left.
    fn install_older_release(root: &Path, contents: &str) {
        std::fs::create_dir_all(root.join(SKILL_NAME)).unwrap();
        std::fs::write(skill_file(root), contents).unwrap();
        std::fs::write(marker_file(root), digest(contents)).unwrap();
    }

    #[test]
    fn an_explicit_install_creates_the_skill_and_its_marker() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            write_skill(dir.path(), EXPLICIT).unwrap(),
            SkillWrite::Installed
        );
        assert_eq!(
            std::fs::read_to_string(skill_file(dir.path())).unwrap(),
            SKILL_CONTENTS
        );
        assert_eq!(
            std::fs::read_to_string(marker_file(dir.path())).unwrap(),
            digest(SKILL_CONTENTS)
        );
    }

    /// The whole point: a new release lands without anyone re-running install.
    #[test]
    fn a_refresh_updates_a_copy_a_previous_release_wrote() {
        let dir = tempfile::tempdir().unwrap();
        install_older_release(dir.path(), "# an older release's skill\n");

        assert_eq!(
            write_skill(dir.path(), Mode::Refresh).unwrap(),
            SkillWrite::Updated
        );
        assert_eq!(
            std::fs::read_to_string(skill_file(dir.path())).unwrap(),
            SKILL_CONTENTS
        );
    }

    /// The thing that must never happen.
    #[test]
    fn an_edited_skill_survives_a_refresh_and_a_plain_install() {
        let dir = tempfile::tempdir().unwrap();
        install_older_release(dir.path(), "# an older release's skill\n");
        let edited = "# an older release's skill\n\nplus my own notes\n";
        std::fs::write(skill_file(dir.path()), edited).unwrap();

        for mode in [Mode::Refresh, EXPLICIT] {
            assert_eq!(
                write_skill(dir.path(), mode).unwrap(),
                SkillWrite::LeftEdited
            );
            assert_eq!(
                std::fs::read_to_string(skill_file(dir.path())).unwrap(),
                edited,
                "{mode:?} must not touch an edited skill"
            );
        }

        // --force is the one thing that overrides a human.
        assert_eq!(
            write_skill(dir.path(), FORCED).unwrap(),
            SkillWrite::Updated
        );
        assert_eq!(
            std::fs::read_to_string(skill_file(dir.path())).unwrap(),
            SKILL_CONTENTS
        );
    }

    /// A launch must not claim a file it cannot prove it wrote, nor create one.
    #[test]
    fn a_refresh_leaves_unmarked_and_absent_skills_alone() {
        let unmarked = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(unmarked.path().join(SKILL_NAME)).unwrap();
        std::fs::write(skill_file(unmarked.path()), "# installed by an older CLI\n").unwrap();

        assert_eq!(
            write_skill(unmarked.path(), Mode::Refresh).unwrap(),
            SkillWrite::NotInstalled
        );
        assert_eq!(
            std::fs::read_to_string(skill_file(unmarked.path())).unwrap(),
            "# installed by an older CLI\n"
        );

        let empty = tempfile::tempdir().unwrap();
        assert_eq!(
            write_skill(empty.path(), Mode::Refresh).unwrap(),
            SkillWrite::NotInstalled
        );
        assert!(!skill_file(empty.path()).exists());
    }

    /// An explicit install adopts that older copy, which is what makes the
    /// first upgrade past this change self-healing from then on.
    #[test]
    fn an_explicit_install_adopts_an_unmarked_copy() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(SKILL_NAME)).unwrap();
        std::fs::write(skill_file(dir.path()), "# installed by an older CLI\n").unwrap();

        assert_eq!(
            write_skill(dir.path(), EXPLICIT).unwrap(),
            SkillWrite::Adopted
        );
        // And now a refresh can carry it forward on its own.
        install_older_release(dir.path(), "# a later release\n");
        assert_eq!(
            write_skill(dir.path(), Mode::Refresh).unwrap(),
            SkillWrite::Updated
        );
    }

    #[test]
    fn a_current_skill_reports_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        write_skill(dir.path(), EXPLICIT).unwrap();
        assert_eq!(
            write_skill(dir.path(), Mode::Refresh).unwrap(),
            SkillWrite::Unchanged
        );
        assert_eq!(
            write_skill(dir.path(), EXPLICIT).unwrap(),
            SkillWrite::Unchanged
        );
    }

    /// A marker left by a release whose skill was current repairs itself, so
    /// an install after a hand-deleted marker doesn't strand the copy.
    #[test]
    fn an_explicit_install_repairs_a_missing_marker() {
        let dir = tempfile::tempdir().unwrap();
        write_skill(dir.path(), EXPLICIT).unwrap();
        std::fs::remove_file(marker_file(dir.path())).unwrap();

        assert_eq!(
            write_skill(dir.path(), EXPLICIT).unwrap(),
            SkillWrite::Adopted
        );
        assert_eq!(
            std::fs::read_to_string(marker_file(dir.path())).unwrap(),
            digest(SKILL_CONTENTS)
        );
    }

    #[test]
    fn writing_removes_superseded_skills() {
        let dir = tempfile::tempdir().unwrap();
        for name in SUPERSEDED {
            std::fs::create_dir_all(dir.path().join(name)).unwrap();
        }
        write_skill(dir.path(), EXPLICIT).unwrap();
        for name in SUPERSEDED {
            assert!(!dir.path().join(name).exists());
        }
    }

    #[test]
    fn only_a_real_change_counts_as_changed() {
        assert!(SkillWrite::Installed.changed());
        assert!(SkillWrite::Updated.changed());
        assert!(SkillWrite::Adopted.changed());
        assert!(!SkillWrite::Unchanged.changed());
        assert!(!SkillWrite::LeftEdited.changed());
        assert!(!SkillWrite::NotInstalled.changed());
    }
}
