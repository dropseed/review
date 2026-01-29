use crate::classify::{check_claude_available, classify_single_hunk, HunkInput};
use crate::cli::OutputFormat;
use crate::trust::patterns::is_valid_pattern_id;
use colored::Colorize;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

// --- Data types ---

#[derive(Debug, Clone, Deserialize)]
pub struct EvalCase {
    pub id: String,
    pub description: String,
    pub file_path: String,
    pub content: String,
    pub expected: ExpectedResult,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExpectedResult {
    pub accept: Vec<String>,
    pub reject: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CaseOutcome {
    Pass,
    FailRejected,
    FailMissed,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct CaseResult {
    pub case_id: String,
    pub outcome: CaseOutcome,
    pub returned_labels: Vec<String>,
    pub reasoning: String,
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvalReport {
    pub model: String,
    pub total_cases: usize,
    pub total_runs: usize,
    pub passed: usize,
    pub failed: usize,
    pub errors: usize,
    pub pass_rate: f64,
    pub per_category: Vec<CategoryScore>,
    pub results: Vec<CaseResult>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CategoryScore {
    pub category: String,
    pub passed: usize,
    pub total: usize,
    pub pass_rate: f64,
}

// --- Core functions ---

fn load_fixtures(
    fixtures_path: Option<&str>,
    tag_filter: Option<&str>,
    case_filter: Option<&str>,
) -> Result<Vec<EvalCase>, String> {
    let json_str = if let Some(path) = fixtures_path {
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read fixtures file: {}", e))?
    } else {
        include_str!("../../../resources/eval/cases.json").to_string()
    };

    let cases: Vec<EvalCase> =
        serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse fixtures: {}", e))?;

    // Validate all labels in cases exist in taxonomy
    for case in &cases {
        for label in &case.expected.accept {
            if !label.is_empty() && !is_valid_pattern_id(label) {
                return Err(format!(
                    "Case '{}': accept label '{}' not found in taxonomy",
                    case.id, label
                ));
            }
        }
        for label in &case.expected.reject {
            if !is_valid_pattern_id(label) {
                return Err(format!(
                    "Case '{}': reject label '{}' not found in taxonomy",
                    case.id, label
                ));
            }
        }
    }

    // Apply filters
    let filtered: Vec<EvalCase> = cases
        .into_iter()
        .filter(|c| {
            if let Some(tag) = tag_filter {
                if !c.tags.iter().any(|t| t == tag) {
                    return false;
                }
            }
            if let Some(case_id) = case_filter {
                if c.id != case_id {
                    return false;
                }
            }
            true
        })
        .collect();

    if filtered.is_empty() {
        return Err("No test cases match the given filters".to_string());
    }

    Ok(filtered)
}

fn run_eval_case(case: &EvalCase, cwd: &PathBuf, model: &str) -> CaseResult {
    let start = Instant::now();
    let hunk = HunkInput {
        id: case.id.clone(),
        file_path: case.file_path.clone(),
        content: case.content.clone(),
    };

    match classify_single_hunk(&hunk, cwd, model, None) {
        Ok((_id, classification)) => {
            let duration = start.elapsed();
            let outcome = score_result(&classification.label, &case.expected);
            CaseResult {
                case_id: case.id.clone(),
                outcome,
                returned_labels: classification.label,
                reasoning: classification.reasoning,
                duration_ms: duration.as_millis() as u64,
                error: None,
            }
        }
        Err(e) => {
            let duration = start.elapsed();
            CaseResult {
                case_id: case.id.clone(),
                outcome: CaseOutcome::Error,
                returned_labels: vec![],
                reasoning: String::new(),
                duration_ms: duration.as_millis() as u64,
                error: Some(e.to_string()),
            }
        }
    }
}

fn score_result(returned_labels: &[String], expected: &ExpectedResult) -> CaseOutcome {
    // Rule 1: If returned labels contain any reject label → FailRejected
    for label in returned_labels {
        if expected.reject.contains(label) {
            return CaseOutcome::FailRejected;
        }
    }

    // Rule 2: If accept is empty (expect empty) and returned labels are empty → Pass
    if expected.accept.is_empty() && returned_labels.is_empty() {
        return CaseOutcome::Pass;
    }

    // Rule 3: If returned labels contain any accept label → Pass
    for label in returned_labels {
        if expected.accept.contains(label) {
            return CaseOutcome::Pass;
        }
    }

    // Rule 4: Otherwise → FailMissed
    CaseOutcome::FailMissed
}

fn build_report(
    model: &str,
    cases: &[EvalCase],
    results: Vec<CaseResult>,
    runs: usize,
) -> EvalReport {
    let passed = results
        .iter()
        .filter(|r| matches!(r.outcome, CaseOutcome::Pass))
        .count();
    let errors = results
        .iter()
        .filter(|r| matches!(r.outcome, CaseOutcome::Error))
        .count();
    let failed = results.len() - passed - errors;
    let pass_rate = if results.is_empty() {
        0.0
    } else {
        (passed as f64 / results.len() as f64) * 100.0
    };

    // Per-category scoring
    let mut category_map: HashMap<String, (usize, usize)> = HashMap::new();
    for (i, case) in cases.iter().enumerate() {
        // Each case may have multiple runs, gather results per run
        for run_idx in 0..runs {
            let result_idx = i * runs + run_idx;
            if result_idx >= results.len() {
                break;
            }
            let result = &results[result_idx];
            let category = if case.expected.accept.is_empty() {
                "none-expected".to_string()
            } else {
                case.tags
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "other".to_string())
            };

            let entry = category_map.entry(category).or_insert((0, 0));
            entry.1 += 1; // total
            if matches!(result.outcome, CaseOutcome::Pass) {
                entry.0 += 1; // passed
            }
        }
    }

    let mut per_category: Vec<CategoryScore> = category_map
        .into_iter()
        .map(|(category, (passed, total))| CategoryScore {
            category,
            passed,
            total,
            pass_rate: if total == 0 {
                0.0
            } else {
                (passed as f64 / total as f64) * 100.0
            },
        })
        .collect();
    per_category.sort_by(|a, b| a.category.cmp(&b.category));

    EvalReport {
        model: model.to_string(),
        total_cases: cases.len(),
        total_runs: runs,
        passed,
        failed,
        errors,
        pass_rate,
        per_category,
        results,
    }
}

fn print_text_report(report: &EvalReport, cases: &[EvalCase], verbose: bool) {
    println!();
    println!("{}", "Classification Eval".bold());
    println!("{}", "===================".bold());
    println!(
        "Model: {} | Cases: {} | Runs: {} | Passed: {}/{} ({:.1}%)",
        report.model.cyan(),
        report.total_cases,
        report.total_runs,
        report.passed,
        report.results.len(),
        report.pass_rate,
    );

    // Per-category
    println!();
    println!("{}", "Per-Category:".bold());
    for cat in &report.per_category {
        let rate_str = format!("{:.1}%", cat.pass_rate);
        let color_rate = if cat.pass_rate >= 100.0 {
            rate_str.green()
        } else if cat.pass_rate >= 50.0 {
            rate_str.yellow()
        } else {
            rate_str.red()
        };
        println!(
            "  {:<16} {}/{}  {}",
            cat.category, cat.passed, cat.total, color_rate
        );
    }

    // Verbose: show every result
    if verbose {
        println!();
        println!("{}", "All Results:".bold());
        for result in &report.results {
            let status = match result.outcome {
                CaseOutcome::Pass => "PASS".green(),
                CaseOutcome::FailRejected => "FAIL".red(),
                CaseOutcome::FailMissed => "FAIL".red(),
                CaseOutcome::Error => "ERR ".red(),
            };
            let labels = if result.returned_labels.is_empty() {
                "(empty)".to_string()
            } else {
                result.returned_labels.join(", ")
            };
            println!(
                "  {}  {:<35} → {}  ({}ms)",
                status, result.case_id, labels, result.duration_ms
            );
        }
    }

    // Failures
    let failures: Vec<&CaseResult> = report
        .results
        .iter()
        .filter(|r| !matches!(r.outcome, CaseOutcome::Pass))
        .collect();

    if !failures.is_empty() {
        println!();
        println!("{}", "Failures:".bold());
        for result in &failures {
            let status = match result.outcome {
                CaseOutcome::FailRejected => "FAIL",
                CaseOutcome::FailMissed => "FAIL",
                CaseOutcome::Error => "ERR ",
                _ => continue,
            };

            println!("  {}  {}", status.red(), result.case_id.bold());

            // Find the case to show expected
            if let Some(case) = cases.iter().find(|c| c.id == result.case_id) {
                let expected_str = if case.expected.accept.is_empty() {
                    "(empty / needs review)".to_string()
                } else {
                    case.expected.accept.join(" | ")
                };
                println!("        Expected: {}", expected_str);
            }

            let got = if result.returned_labels.is_empty() {
                "(empty)".to_string()
            } else {
                result.returned_labels.join(", ")
            };
            println!("        Got:      {}", got);

            if let Some(ref err) = result.error {
                println!("        Error:    {}", err);
            } else if !result.reasoning.is_empty() {
                println!("        Reason:   \"{}\"", result.reasoning);
            }
        }
    }
}

fn print_json_report(report: &EvalReport) {
    println!(
        "{}",
        serde_json::to_string_pretty(report).expect("failed to serialize report")
    );
}

// --- CLI entry point ---

pub fn run(
    model: &str,
    runs: usize,
    tag: Option<&str>,
    case: Option<&str>,
    fixtures: Option<&str>,
    concurrency: usize,
    verbose: bool,
    format: OutputFormat,
) -> Result<(), String> {
    if !check_claude_available() {
        return Err(
            "Claude CLI not found. Please install: npm install -g @anthropic-ai/claude-code"
                .to_string(),
        );
    }

    let cases = load_fixtures(fixtures, tag, case)?;

    let cwd = std::env::current_dir().map_err(|e| format!("Failed to get cwd: {}", e))?;

    if format == OutputFormat::Text {
        println!(
            "Running {} case(s) x {} run(s) with model {}...",
            cases.len().to_string().cyan(),
            runs,
            model.cyan(),
        );
    }

    // Run eval cases
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(concurrency));
    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;

    let all_results: Vec<CaseResult> = rt.block_on(async {
        let mut tasks = Vec::new();

        for case in &cases {
            for _ in 0..runs {
                let case = case.clone();
                let cwd = cwd.clone();
                let model = model.to_string();
                let sem = semaphore.clone();

                tasks.push(tokio::spawn(async move {
                    let _permit = sem.acquire().await.expect("semaphore closed");
                    tokio::task::spawn_blocking(move || run_eval_case(&case, &cwd, &model))
                        .await
                        .expect("blocking task failed")
                }));
            }
        }

        let mut results = Vec::new();
        for task in tasks {
            results.push(task.await.expect("task join failed"));
        }
        results
    });

    let report = build_report(model, &cases, all_results, runs);

    match format {
        OutputFormat::Text => print_text_report(&report, &cases, verbose),
        OutputFormat::Json => print_json_report(&report),
    }

    // Exit code
    if report.errors > 0 {
        std::process::exit(2);
    } else if report.failed > 0 {
        std::process::exit(1);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_score_pass_with_matching_label() {
        let expected = ExpectedResult {
            accept: vec!["imports:added".to_string()],
            reject: vec![],
        };
        let outcome = score_result(&["imports:added".to_string()], &expected);
        assert!(matches!(outcome, CaseOutcome::Pass));
    }

    #[test]
    fn test_score_pass_empty_expected_empty_returned() {
        let expected = ExpectedResult {
            accept: vec![],
            reject: vec![],
        };
        let outcome = score_result(&[], &expected);
        assert!(matches!(outcome, CaseOutcome::Pass));
    }

    #[test]
    fn test_score_fail_rejected() {
        let expected = ExpectedResult {
            accept: vec![],
            reject: vec!["formatting:whitespace".to_string()],
        };
        let outcome = score_result(&["formatting:whitespace".to_string()], &expected);
        assert!(matches!(outcome, CaseOutcome::FailRejected));
    }

    #[test]
    fn test_score_fail_missed() {
        let expected = ExpectedResult {
            accept: vec!["imports:added".to_string()],
            reject: vec![],
        };
        let outcome = score_result(&[], &expected);
        assert!(matches!(outcome, CaseOutcome::FailMissed));
    }

    #[test]
    fn test_score_reject_takes_priority() {
        let expected = ExpectedResult {
            accept: vec!["imports:added".to_string()],
            reject: vec!["formatting:whitespace".to_string()],
        };
        let outcome = score_result(
            &[
                "formatting:whitespace".to_string(),
                "imports:added".to_string(),
            ],
            &expected,
        );
        assert!(matches!(outcome, CaseOutcome::FailRejected));
    }

    #[test]
    fn test_score_fail_missed_wrong_label() {
        let expected = ExpectedResult {
            accept: vec!["imports:added".to_string()],
            reject: vec![],
        };
        let outcome = score_result(&["formatting:whitespace".to_string()], &expected);
        assert!(matches!(outcome, CaseOutcome::FailMissed));
    }

    #[test]
    fn test_load_bundled_fixtures() {
        let cases = load_fixtures(None, None, None).unwrap();
        assert!(!cases.is_empty());
    }

    #[test]
    fn test_load_fixtures_tag_filter() {
        let cases = load_fixtures(None, Some("imports"), None).unwrap();
        assert!(cases
            .iter()
            .all(|c| c.tags.contains(&"imports".to_string())));
    }

    #[test]
    fn test_load_fixtures_case_filter() {
        let cases = load_fixtures(None, None, Some("imports-added-python-01")).unwrap();
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].id, "imports-added-python-01");
    }

    #[test]
    fn test_load_fixtures_no_match() {
        let result = load_fixtures(None, Some("nonexistent-tag"), None);
        assert!(result.is_err());
    }
}
