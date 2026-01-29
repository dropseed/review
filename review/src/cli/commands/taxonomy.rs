use crate::cli::OutputFormat;
use crate::trust::patterns::get_trust_taxonomy_with_custom;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(repo_path: &str, category: Option<String>, format: OutputFormat) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    let taxonomy = get_trust_taxonomy_with_custom(&path);

    // Filter by category if specified
    let categories: Vec<_> = if let Some(ref cat) = category {
        taxonomy
            .into_iter()
            .filter(|c| {
                c.name.to_lowercase() == cat.to_lowercase()
                    || c.id.to_lowercase() == cat.to_lowercase()
            })
            .collect()
    } else {
        taxonomy
    };

    if categories.is_empty() {
        if let Some(cat) = category {
            return Err(format!("Category '{cat}' not found"));
        }
        return Err("No taxonomy categories found".to_owned());
    }

    if format == OutputFormat::Json {
        let output: Vec<_> = categories
            .iter()
            .map(|c| {
                serde_json::json!({
                    "id": c.id,
                    "name": c.name,
                    "description": c.description,
                    "patterns": c.patterns.iter().map(|p| {
                        serde_json::json!({
                            "id": p.id,
                            "name": p.name,
                            "description": p.description,
                        })
                    }).collect::<Vec<_>>(),
                })
            })
            .collect();
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("failed to serialize JSON output")
        );
        return Ok(());
    }

    // Text output
    for (i, cat) in categories.iter().enumerate() {
        if i > 0 {
            println!();
        }

        println!("{}", cat.name.bold().cyan());
        if !cat.description.is_empty() {
            println!("  {}", cat.description.dimmed());
        }
        println!();

        for pattern in &cat.patterns {
            let full_label = format!("{}:{}", cat.id, pattern.id);
            println!("  {}", full_label.green());
            if !pattern.description.is_empty() {
                println!("    {}", pattern.description.dimmed());
            }
        }
    }

    Ok(())
}
