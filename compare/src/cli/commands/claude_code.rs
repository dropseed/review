use crate::claude_code;
use crate::cli::OutputFormat;
use colored::Colorize;

pub fn run(repo_path: &str, format: OutputFormat) -> Result<(), String> {
    let status = claude_code::check_sessions(repo_path);

    if format == OutputFormat::Json {
        let output = serde_json::json!({
            "active": status.active,
            "session_count": status.session_count,
            "last_activity": status.last_activity,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("failed to serialize JSON output")
        );
        return Ok(());
    }

    if status.active {
        let ago = match &status.last_activity {
            Some(ts) => format!(" (last activity {})", ts),
            None => String::new(),
        };
        println!(
            "Claude Code: {} {}",
            "Active".green().bold(),
            format!("{}, {} sessions", ago, status.session_count).dimmed()
        );
    } else if status.session_count > 0 {
        println!(
            "Claude Code: {} {}",
            "Inactive".yellow(),
            format!("{} sessions", status.session_count).dimmed()
        );
    } else {
        println!("Claude Code: {}", "No sessions".dimmed());
    }

    Ok(())
}
