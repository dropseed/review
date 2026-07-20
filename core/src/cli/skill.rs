//! `review skill` — install the bundled skills for Claude Code and/or Codex.

use std::path::PathBuf;

use clap::{Args, Subcommand};

/// The bundled skills, embedded into the binary at build time so the shipped
/// CLI can install them without the source repo present.
const SKILLS: &[(&str, &str)] = &[(
    "review-guide",
    include_str!("../../resources/skills/review-guide/SKILL.md"),
)];

#[derive(Debug, Args)]
pub struct SkillArgs {
    #[command(subcommand)]
    pub action: SkillAction,
}

#[derive(Debug, Subcommand)]
pub enum SkillAction {
    /// Install the bundled skills for Claude Code and Codex
    Install,
}

pub fn run_skill(args: SkillArgs) -> Result<(), String> {
    match args.action {
        SkillAction::Install => install_skill(),
    }
}

/// Install the bundled skills into both `~/.claude/skills/` and
/// `$CODEX_HOME/skills/` (defaulting to `~/.codex/skills/`).
fn install_skill() -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not determine the home directory.")?;

    let claude_dir = home.join(".claude").join("skills");
    write_skills("Claude Code", &claude_dir)?;

    let codex_home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    let codex_dir = codex_home.join("skills");
    write_skills("Codex", &codex_dir)?;

    println!("Restart Claude Code or Codex to pick up the skills.");
    Ok(())
}

fn write_skills(tool: &str, skills_root: &std::path::Path) -> Result<(), String> {
    for (name, contents) in SKILLS {
        write_skill(tool, skills_root, name, contents)?;
    }
    Ok(())
}

fn write_skill(
    tool: &str,
    skills_root: &std::path::Path,
    name: &str,
    contents: &str,
) -> Result<(), String> {
    let skill_dir = skills_root.join(name);
    let skill_file = skill_dir.join("SKILL.md");

    let updating = skill_file.exists();
    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create {}: {e}", skill_dir.display()))?;
    std::fs::write(&skill_file, contents)
        .map_err(|e| format!("Failed to write {}: {e}", skill_file.display()))?;

    let verb = if updating { "Updated" } else { "Installed" };
    println!(
        "{verb} the {name} skill for {tool} at {}",
        skill_file.display()
    );
    Ok(())
}
