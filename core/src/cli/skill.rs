//! `review skill` — install the bundled skill for Claude Code and/or Codex.

use clap::{Args, Subcommand};

/// The bundled skill, embedded into the binary at build time so the shipped
/// CLI can install it without the source repo present.
const SKILL_NAME: &str = "review-app";
const SKILL_CONTENTS: &str = include_str!("../../resources/skills/review-app/SKILL.md");

/// Skills earlier versions installed, now folded into [`SKILL_NAME`]. Removed on
/// install so an upgraded CLI doesn't leave three overlapping skills behind.
const SUPERSEDED: &[&str] = &["review-guide", "review-terminals"];

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
    write_skill("Claude Code", &claude_dir)?;

    let codex_dir = crate::service::util::codex_home()
        .ok_or("Could not determine the Codex home directory.")?
        .join("skills");
    write_skill("Codex", &codex_dir)?;

    println!("Restart Claude Code or Codex to pick up the skill.");
    Ok(())
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
