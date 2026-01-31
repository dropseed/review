use clap::Subcommand;
use colored::Colorize;
use std::path::PathBuf;

const SKILL_CONTENT: &str = include_str!("../../../resources/skills/git-review/SKILL.md");

#[derive(Debug, Subcommand)]
pub enum AgentCommands {
    /// Install the git-review skill for Claude Code
    Install {
        /// Install globally (~/.claude/skills/) instead of project-level
        #[arg(long)]
        global: bool,
    },
}

pub fn run(command: AgentCommands) -> Result<(), String> {
    match command {
        AgentCommands::Install { global } => install(global),
    }
}

fn install(global: bool) -> Result<(), String> {
    let skill_dir = if global {
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        home.join(".claude/skills/git-review")
    } else {
        // Find the repo root by walking up from cwd
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
        let repo_root = find_repo_root(&cwd).ok_or(
            "Not in a git repository. Use --global to install globally, or run from a git repo.",
        )?;
        repo_root.join(".claude/skills/git-review")
    };

    let skill_path = skill_dir.join("SKILL.md");
    let updating = skill_path.exists();

    std::fs::create_dir_all(&skill_dir).map_err(|e| format!("Failed to create directory: {e}"))?;
    std::fs::write(&skill_path, SKILL_CONTENT)
        .map_err(|e| format!("Failed to write SKILL.md: {e}"))?;

    let action = if updating { "Updated" } else { "Installed" };
    println!(
        "{} {} {}",
        "✓".green(),
        action,
        skill_path.display().to_string().dimmed()
    );

    if !global {
        println!(
            "  {} Commit {} to share with your team.",
            "hint:".dimmed(),
            ".claude/skills/".cyan()
        );
    }

    Ok(())
}

fn find_repo_root(start: &std::path::Path) -> Option<PathBuf> {
    let mut current = start;
    loop {
        if current.join(".git").exists() {
            return Some(current.to_path_buf());
        }
        current = current.parent()?;
    }
}
