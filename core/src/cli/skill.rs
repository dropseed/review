//! `review skill` — install the bundled `review-guide` skill for Claude Code.

use clap::{Args, Subcommand};

/// The `review-guide` skill, embedded into the binary at build time so the
/// shipped CLI can install it without the source repo present.
const SKILL_MD: &str = include_str!("../../resources/skills/review-guide/SKILL.md");
const SKILL_NAME: &str = "review-guide";

#[derive(Debug, Args)]
pub struct SkillArgs {
    #[command(subcommand)]
    pub action: SkillAction,
}

#[derive(Debug, Subcommand)]
pub enum SkillAction {
    /// Install the review-guide skill into ~/.claude/skills/
    Install,
}

pub fn run_skill(args: SkillArgs) -> Result<(), String> {
    match args.action {
        SkillAction::Install => install_skill(),
    }
}

/// Write the bundled skill to `~/.claude/skills/review-guide/SKILL.md`.
fn install_skill() -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not determine the home directory.")?;
    let skill_dir = home.join(".claude").join("skills").join(SKILL_NAME);
    let skill_file = skill_dir.join("SKILL.md");

    let updating = skill_file.exists();
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create {}: {e}", skill_dir.display()))?;
    std::fs::write(&skill_file, SKILL_MD)
        .map_err(|e| format!("Failed to write {}: {e}", skill_file.display()))?;

    let verb = if updating { "Updated" } else { "Installed" };
    println!("{verb} the {SKILL_NAME} skill at {}", skill_file.display());
    println!("Claude Code picks it up in any repo — restart it if it's running.");
    Ok(())
}
