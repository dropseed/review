//! `spur skill` — install the bundled skill for Claude Code and/or Codex.
//!
//! The writing itself lives in [`crate::skill`], which the desktop app also
//! calls on launch to carry an installed copy across releases. This is the
//! explicit half: it adopts a copy an older CLI left unmarked, and `--force`
//! is the one thing that overwrites a skill the human edited.

use clap::{Args, Subcommand};

use crate::skill::{self, Mode, SkillWrite};

#[derive(Debug, Args)]
pub struct SkillArgs {
    #[command(subcommand)]
    pub action: SkillAction,
}

#[derive(Debug, Subcommand)]
pub enum SkillAction {
    /// Install the bundled skill for Claude Code and Codex
    Install {
        /// Overwrite a skill that has been edited since it was installed
        #[arg(long)]
        force: bool,
    },
}

pub fn run_skill(args: SkillArgs) -> Result<(), String> {
    match args.action {
        SkillAction::Install { force } => install_skill(force),
    }
}

/// Install into every tool's skills directory, reporting each independently.
fn install_skill(force: bool) -> Result<(), String> {
    let roots = skill::install_roots();
    if roots.is_empty() {
        return Err("Could not determine the home directory.".to_owned());
    }

    let results: Vec<(&str, Result<SkillWrite, String>)> = roots
        .into_iter()
        .map(|(tool, root)| {
            let outcome = skill::write_skill(&root, Mode::Explicit { force })
                .map_err(|e| format!("Failed to write {}: {e}", root.display()));
            if let Ok(outcome) = &outcome {
                report(tool, *outcome, &root);
            }
            (tool, outcome)
        })
        .collect();

    finish_install(&results)
}

fn report(tool: &str, outcome: SkillWrite, root: &std::path::Path) {
    let file = root.join(skill::SKILL_NAME).join("SKILL.md");
    match outcome {
        SkillWrite::Installed => println!("Installed the {} skill for {tool} at {}", skill::SKILL_NAME, file.display()),
        SkillWrite::Updated | SkillWrite::Adopted => {
            println!("Updated the {} skill for {tool} at {}", skill::SKILL_NAME, file.display())
        }
        SkillWrite::Unchanged => println!("The {} skill for {tool} is already current.", skill::SKILL_NAME),
        SkillWrite::LeftEdited => eprintln!(
            "{} has been edited since it was installed — left as it is. Re-run with --force to overwrite it.",
            file.display()
        ),
        // Only a refresh can produce this; an explicit install always writes.
        SkillWrite::NotInstalled => {}
    }
}

/// Combine the per-tool installs into one outcome. Each tool's skills
/// directory is unrelated to the other's, so one failing (a read-only
/// `$CODEX_HOME`, say) is not a reason to hide that the other succeeded —
/// only fail the command outright when none of them landed.
fn finish_install(results: &[(&str, Result<SkillWrite, String>)]) -> Result<(), String> {
    for (tool, result) in results {
        if let Err(e) = result {
            eprintln!("Warning: skipped {tool} ({e})");
        }
    }

    let errors: Vec<&str> = results
        .iter()
        .filter_map(|(_, r)| r.as_ref().err().map(String::as_str))
        .collect();
    if errors.len() == results.len() {
        return Err(errors.join("\n"));
    }

    // Only worth saying when something actually changed on disk.
    let landed: Vec<&str> = results
        .iter()
        .filter(|(_, r)| r.as_ref().is_ok_and(|o| o.changed()))
        .map(|(tool, _)| *tool)
        .collect();
    match landed.as_slice() {
        [] => {}
        [one] => println!("Restart {one} to pick up the skill."),
        many => println!("Restart {} to pick up the skill.", many.join(" or ")),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(o: SkillWrite) -> Result<SkillWrite, String> {
        Ok(o)
    }

    #[test]
    fn install_succeeds_if_either_tool_landed() {
        assert!(finish_install(&[
            ("Claude Code", ok(SkillWrite::Installed)),
            ("Codex", ok(SkillWrite::Installed)),
        ])
        .is_ok());
        assert!(finish_install(&[
            ("Claude Code", ok(SkillWrite::Installed)),
            ("Codex", Err("codex boom".into())),
        ])
        .is_ok());
        assert!(finish_install(&[
            ("Claude Code", Err("claude boom".into())),
            ("Codex", ok(SkillWrite::Updated)),
        ])
        .is_ok());
    }

    #[test]
    fn install_fails_only_when_every_tool_failed() {
        let err = finish_install(&[
            ("Claude Code", Err("claude boom".into())),
            ("Codex", Err("codex boom".into())),
        ])
        .expect_err("every install failing should be reported as failure");
        assert!(err.contains("claude boom"));
        assert!(err.contains("codex boom"));
    }

    /// An edited skill is not an error — the command reports it and exits 0,
    /// since nothing went wrong and the fix is a flag the human chooses.
    #[test]
    fn a_skill_left_edited_is_not_a_failure() {
        assert!(finish_install(&[("Claude Code", ok(SkillWrite::LeftEdited))]).is_ok());
    }
}
