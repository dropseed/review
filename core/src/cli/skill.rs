//! `spur skill` — install the bundled skill for Claude Code and/or Codex.

use clap::{Args, Subcommand};

/// The bundled skill, embedded into the binary at build time so the shipped
/// CLI can install it without the source repo present.
const SKILL_NAME: &str = "spur-app";
const SKILL_CONTENTS: &str = include_str!("../../resources/skills/spur-app/SKILL.md");

/// Skills earlier versions installed, now folded into [`SKILL_NAME`]. Removed on
/// install so an upgraded CLI doesn't leave overlapping skills behind.
///
/// `review-app` is this same skill under the app's old name, and leaving it in
/// place is worse than leaving a merely redundant one: every command in it
/// spells the CLI `review`, which after the rename is either absent or a stale
/// binary resolving a home Spur no longer writes to. An agent reading it would
/// drive the wrong instance.
const SUPERSEDED: &[&str] = &["review-app", "review-guide", "review-terminals"];

#[derive(Debug, Args)]
pub struct SkillArgs {
    #[command(subcommand)]
    pub action: SkillAction,
}

#[derive(Debug, Subcommand)]
pub enum SkillAction {
    /// Install the bundled skill for Claude Code and Codex
    Install,
}

pub fn run_skill(args: SkillArgs) -> Result<(), String> {
    match args.action {
        SkillAction::Install => install_skill(),
    }
}

/// Install the bundled skill into both `~/.claude/skills/` and
/// `$CODEX_HOME/skills/` (defaulting to `~/.codex/skills/`).
fn install_skill() -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not determine the home directory.")?;

    let claude_dir = home.join(".claude").join("skills");
    let claude_result = write_skill("Claude Code", &claude_dir);

    let codex_result = crate::service::util::codex_home()
        .ok_or_else(|| "Could not determine the Codex home directory.".to_owned())
        .and_then(|dir| write_skill("Codex", &dir.join("skills")));

    finish_install(claude_result, codex_result)
}

/// Combine the two independent installs into one outcome. Each tool's skills
/// directory is unrelated to the other's, so one failing (a read-only
/// `$CODEX_HOME`, say) is not a reason to hide that the other succeeded —
/// only fail the command outright when neither install landed.
fn finish_install(claude: Result<(), String>, codex: Result<(), String>) -> Result<(), String> {
    match (claude, codex) {
        (Ok(()), Ok(())) => {
            println!("Restart Claude Code or Codex to pick up the skill.");
            Ok(())
        }
        (Ok(()), Err(e)) => {
            eprintln!("Warning: skipped Codex ({e})");
            println!("Restart Claude Code to pick up the skill.");
            Ok(())
        }
        (Err(e), Ok(())) => {
            eprintln!("Warning: skipped Claude Code ({e})");
            println!("Restart Codex to pick up the skill.");
            Ok(())
        }
        (Err(e1), Err(e2)) => Err(format!("{e1}\n{e2}")),
    }
}

fn write_skill(tool: &str, skills_root: &std::path::Path) -> Result<(), String> {
    let skill_dir = skills_root.join(SKILL_NAME);
    let skill_file = skill_dir.join("SKILL.md");

    let updating = skill_file.exists();
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create {}: {e}", skill_dir.display()))?;
    std::fs::write(&skill_file, SKILL_CONTENTS)
        .map_err(|e| format!("Failed to write {}: {e}", skill_file.display()))?;

    let verb = if updating { "Updated" } else { "Installed" };
    println!(
        "{verb} the {SKILL_NAME} skill for {tool} at {}",
        skill_file.display()
    );

    remove_superseded(skills_root);
    Ok(())
}

/// Delete the skills this one replaced. Best-effort: a skill the user edited or
/// never had is not worth failing the install over, so failures are silent.
fn remove_superseded(skills_root: &std::path::Path) {
    for name in SUPERSEDED {
        let dir = skills_root.join(name);
        if dir.is_dir() && std::fs::remove_dir_all(&dir).is_ok() {
            println!("Removed the superseded {name} skill at {}", dir.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finish_install_succeeds_if_either_tool_landed() {
        assert!(finish_install(Ok(()), Ok(())).is_ok());
        assert!(finish_install(Ok(()), Err("codex boom".into())).is_ok());
        assert!(finish_install(Err("claude boom".into()), Ok(())).is_ok());
    }

    #[test]
    fn finish_install_fails_only_when_both_tools_failed() {
        let err = finish_install(Err("claude boom".into()), Err("codex boom".into()))
            .expect_err("both installs failing should be reported as failure");
        assert!(err.contains("claude boom"));
        assert!(err.contains("codex boom"));
    }

    #[test]
    fn write_skill_creates_then_updates() {
        let dir = tempfile::tempdir().unwrap();
        let skill_file = dir.path().join(SKILL_NAME).join("SKILL.md");

        write_skill("Claude Code", dir.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(&skill_file).unwrap(),
            SKILL_CONTENTS
        );

        // Writing again over an existing install is still Ok, not a fresh-install error.
        write_skill("Claude Code", dir.path()).unwrap();
    }

    #[test]
    fn write_skill_removes_superseded_skills() {
        let dir = tempfile::tempdir().unwrap();
        for name in SUPERSEDED {
            std::fs::create_dir_all(dir.path().join(name)).unwrap();
        }

        write_skill("Claude Code", dir.path()).unwrap();

        for name in SUPERSEDED {
            assert!(!dir.path().join(name).exists());
        }
    }
}
