use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    pub id: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "oldStart")]
    pub old_start: u32,
    #[serde(rename = "oldCount")]
    pub old_count: u32,
    #[serde(rename = "newStart")]
    pub new_start: u32,
    #[serde(rename = "newCount")]
    pub new_count: u32,
    pub content: String,
    pub lines: Vec<DiffLine>,
    /// Content hash (without filepath) for move detection
    #[serde(rename = "contentHash")]
    pub content_hash: String,
    /// ID of the paired hunk if this is part of a move
    #[serde(rename = "movePairId", skip_serializing_if = "Option::is_none")]
    pub move_pair_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub line_type: LineType,
    pub content: String,
    #[serde(rename = "oldLineNumber")]
    pub old_line_number: Option<u32>,
    #[serde(rename = "newLineNumber")]
    pub new_line_number: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineType {
    Context,
    Added,
    Removed,
}

/// Parse a git diff output into hunks
pub fn parse_diff(diff_output: &str, file_path: &str) -> Vec<DiffHunk> {
    let mut hunks = Vec::new();
    let mut current_hunk: Option<HunkBuilder> = None;

    for line in diff_output.lines() {
        // Hunk header: @@ -old_start,old_count +new_start,new_count @@
        if line.starts_with("@@") {
            // Finish previous hunk if any
            if let Some(builder) = current_hunk.take() {
                hunks.push(builder.build(file_path));
            }

            // Parse hunk header
            if let Some((old_start, old_count, new_start, new_count)) = parse_hunk_header(line) {
                current_hunk = Some(HunkBuilder {
                    old_start,
                    old_count,
                    new_start,
                    new_count,
                    content: String::new(),
                    lines: Vec::new(),
                    old_line: old_start,
                    new_line: new_start,
                });
            }
        } else if let Some(ref mut builder) = current_hunk {
            // Process hunk line
            if line.starts_with('+') && !line.starts_with("+++") {
                builder.add_line(LineType::Added, &line[1..]);
            } else if line.starts_with('-') && !line.starts_with("---") {
                builder.add_line(LineType::Removed, &line[1..]);
            } else if line.starts_with(' ') || line.is_empty() {
                let content = if line.is_empty() { "" } else { &line[1..] };
                builder.add_line(LineType::Context, content);
            }
        }
    }

    // Don't forget the last hunk
    if let Some(builder) = current_hunk {
        hunks.push(builder.build(file_path));
    }

    hunks
}

/// Parse a combined multi-file git diff output into hunks.
/// Splits on "diff --git" boundaries, extracts the file path from "+++ b/" lines,
/// and delegates each section to `parse_diff`.
pub fn parse_multi_file_diff(diff_output: &str) -> Vec<DiffHunk> {
    let mut hunks = Vec::new();
    let mut current_section = String::new();
    let mut current_file: Option<String> = None;

    for line in diff_output.lines() {
        if line.starts_with("diff --git ") {
            // Flush previous section
            if let Some(ref file_path) = current_file {
                if !current_section.is_empty() {
                    hunks.extend(parse_diff(&current_section, file_path));
                }
            }
            current_section.clear();
            current_file = None;
        } else if let Some(path) = line.strip_prefix("+++ b/") {
            current_file = Some(path.to_owned());
        } else if line.starts_with("+++ /dev/null") {
            // File was deleted — use the path from "--- a/" which we already skipped,
            // but we can extract it from the "diff --git" line. For deleted files,
            // the hunks won't match any requested file_path so they'll be filtered out.
            // We still need a file path for parse_diff, so try to extract from --- line.
            // Actually, we need to handle this: let's track the --- path too.
            // For now, current_file stays None and we skip this section.
        } else {
            current_section.push_str(line);
            current_section.push('\n');
        }
    }

    // Flush last section
    if let Some(ref file_path) = current_file {
        if !current_section.is_empty() {
            hunks.extend(parse_diff(&current_section, file_path));
        }
    }

    hunks
}

struct HunkBuilder {
    old_start: u32,
    old_count: u32,
    new_start: u32,
    new_count: u32,
    content: String,
    lines: Vec<DiffLine>,
    old_line: u32,
    new_line: u32,
}

impl HunkBuilder {
    fn add_line(&mut self, line_type: LineType, content: &str) {
        let (old_ln, new_ln) = match line_type {
            LineType::Added => {
                let n = self.new_line;
                self.new_line += 1;
                (None, Some(n))
            }
            LineType::Removed => {
                let o = self.old_line;
                self.old_line += 1;
                (Some(o), None)
            }
            LineType::Context => {
                let o = self.old_line;
                let n = self.new_line;
                self.old_line += 1;
                self.new_line += 1;
                (Some(o), Some(n))
            }
        };

        self.content.push_str(content);
        self.content.push('\n');

        self.lines.push(DiffLine {
            line_type,
            content: content.to_owned(),
            old_line_number: old_ln,
            new_line_number: new_ln,
        });
    }

    fn build(self, file_path: &str) -> DiffHunk {
        // Generate content-only hash for move detection
        let mut content_hasher = Sha256::new();
        content_hasher.update(self.content.as_bytes());
        let content_hash = hex::encode(&content_hasher.finalize()[..8]);

        // Generate unique ID from filepath and content hash
        let id = format!("{file_path}:{content_hash}");

        DiffHunk {
            id,
            file_path: file_path.to_owned(),
            old_start: self.old_start,
            old_count: self.old_count,
            new_start: self.new_start,
            new_count: self.new_count,
            content: self.content,
            lines: self.lines,
            content_hash,
            move_pair_id: None,
        }
    }
}

fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    // @@ -1,5 +1,7 @@ optional context
    let line = line.trim_start_matches("@@ ");
    let parts: Vec<&str> = line.split(' ').collect();
    if parts.len() < 2 {
        return None;
    }

    let old = parts[0].trim_start_matches('-');
    let new = parts[1].trim_start_matches('+');

    let (old_start, old_count) = parse_range(old)?;
    let (new_start, new_count) = parse_range(new)?;

    Some((old_start, old_count, new_start, new_count))
}

fn parse_range(range: &str) -> Option<(u32, u32)> {
    if let Some((start, count)) = range.split_once(',') {
        Some((start.parse().ok()?, count.parse().ok()?))
    } else {
        // Single line: "5" means line 5, count 1
        Some((range.parse().ok()?, 1))
    }
}

/// Create a hunk for an untracked (new) file.
/// The hunk ID is based on the filepath for stability.
pub fn create_untracked_hunk(file_path: &str) -> DiffHunk {
    let content = "(untracked file)".to_owned();
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let content_hash = hex::encode(&hasher.finalize()[..8]);

    DiffHunk {
        id: format!("{file_path}:{content_hash}"),
        file_path: file_path.to_owned(),
        old_start: 0,
        old_count: 0,
        new_start: 1,
        new_count: 1,
        content,
        lines: vec![DiffLine {
            line_type: LineType::Added,
            content: "(new file)".to_owned(),
            old_line_number: None,
            new_line_number: Some(1),
        }],
        content_hash,
        move_pair_id: None,
    }
}

/// Represents a detected move pair
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MovePair {
    #[serde(rename = "sourceHunkId")]
    pub source_hunk_id: String,
    #[serde(rename = "destHunkId")]
    pub dest_hunk_id: String,
    #[serde(rename = "sourceFilePath")]
    pub source_file_path: String,
    #[serde(rename = "destFilePath")]
    pub dest_file_path: String,
}

/// Check if a hunk consists only of removed lines (deletions-only)
fn is_deletions_only(hunk: &DiffHunk) -> bool {
    hunk.lines
        .iter()
        .all(|line| matches!(line.line_type, LineType::Removed | LineType::Context))
        && hunk
            .lines
            .iter()
            .any(|line| matches!(line.line_type, LineType::Removed))
}

/// Check if a hunk consists only of added lines (additions-only)
fn is_additions_only(hunk: &DiffHunk) -> bool {
    hunk.lines
        .iter()
        .all(|line| matches!(line.line_type, LineType::Added | LineType::Context))
        && hunk
            .lines
            .iter()
            .any(|line| matches!(line.line_type, LineType::Added))
}

/// Extract only the changed content (without context) from a hunk for move comparison
fn extract_changed_content(hunk: &DiffHunk) -> String {
    hunk.lines
        .iter()
        .filter(|line| matches!(line.line_type, LineType::Added | LineType::Removed))
        .map(|line| line.content.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Compute a hash of only the changed content (without context lines)
fn compute_changed_content_hash(hunk: &DiffHunk) -> String {
    let changed_content = extract_changed_content(hunk);
    let mut hasher = Sha256::new();
    hasher.update(changed_content.as_bytes());
    hex::encode(&hasher.finalize()[..8])
}

/// Detect move pairs in a list of hunks.
/// A move is detected when:
/// - Two hunks have the same changed content hash
/// - One hunk is deletions-only (source)
/// - One hunk is additions-only (destination)
/// - They are in different files
pub fn detect_move_pairs(hunks: &mut [DiffHunk]) -> Vec<MovePair> {
    use std::collections::HashMap;

    let mut move_pairs = Vec::new();

    // Group hunks by their changed content hash
    let mut deletions_by_hash: HashMap<String, Vec<usize>> = HashMap::new();
    let mut additions_by_hash: HashMap<String, Vec<usize>> = HashMap::new();

    for (idx, hunk) in hunks.iter().enumerate() {
        let changed_hash = compute_changed_content_hash(hunk);

        if is_deletions_only(hunk) {
            deletions_by_hash.entry(changed_hash).or_default().push(idx);
        } else if is_additions_only(hunk) {
            additions_by_hash.entry(changed_hash).or_default().push(idx);
        }
    }

    // Find matching pairs
    for (hash, deletion_indices) in &deletions_by_hash {
        if let Some(addition_indices) = additions_by_hash.get(hash) {
            // Match deletions with additions
            for &del_idx in deletion_indices {
                for &add_idx in addition_indices {
                    let del_hunk = &hunks[del_idx];
                    let add_hunk = &hunks[add_idx];

                    // Only consider moves between different files
                    if del_hunk.file_path != add_hunk.file_path {
                        move_pairs.push(MovePair {
                            source_hunk_id: del_hunk.id.clone(),
                            dest_hunk_id: add_hunk.id.clone(),
                            source_file_path: del_hunk.file_path.clone(),
                            dest_file_path: add_hunk.file_path.clone(),
                        });
                    }
                }
            }
        }
    }

    // Update hunk move_pair_id fields
    for pair in &move_pairs {
        for hunk in hunks.iter_mut() {
            if hunk.id == pair.source_hunk_id {
                hunk.move_pair_id = Some(pair.dest_hunk_id.clone());
            } else if hunk.id == pair.dest_hunk_id {
                hunk.move_pair_id = Some(pair.source_hunk_id.clone());
            }
        }
    }

    move_pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hunk_header() {
        assert_eq!(parse_hunk_header("@@ -1,5 +1,7 @@"), Some((1, 5, 1, 7)));
        assert_eq!(
            parse_hunk_header("@@ -10,3 +12,5 @@ function foo()"),
            Some((10, 3, 12, 5))
        );
    }

    #[test]
    fn test_parse_hunk_header_single_line() {
        // Single line changes: count defaults to 1
        assert_eq!(parse_hunk_header("@@ -5 +5 @@"), Some((5, 1, 5, 1)));
        assert_eq!(parse_hunk_header("@@ -1 +1,3 @@"), Some((1, 1, 1, 3)));
        assert_eq!(parse_hunk_header("@@ -1,3 +1 @@"), Some((1, 3, 1, 1)));
    }

    #[test]
    fn test_parse_hunk_header_zero_lines() {
        // Deletion or insertion with 0 lines
        assert_eq!(parse_hunk_header("@@ -1,0 +1,5 @@"), Some((1, 0, 1, 5)));
        assert_eq!(parse_hunk_header("@@ -1,5 +1,0 @@"), Some((1, 5, 1, 0)));
    }

    #[test]
    fn test_create_untracked_hunk() {
        let hunk = create_untracked_hunk("src/new_file.rs");
        assert_eq!(hunk.file_path, "src/new_file.rs");
        assert!(hunk.id.starts_with("src/new_file.rs:"));
        assert_eq!(hunk.old_start, 0);
        assert_eq!(hunk.old_count, 0);
        assert_eq!(hunk.new_start, 1);
        assert_eq!(hunk.new_count, 1);
        assert_eq!(hunk.lines.len(), 1);
        assert!(hunk.move_pair_id.is_none());
    }

    #[test]
    fn test_parse_diff_empty() {
        let hunks = parse_diff("", "test.rs");
        assert!(hunks.is_empty());
    }

    #[test]
    fn test_parse_diff_simple_addition() {
        let diff = "@@ -1,3 +1,4 @@\n context\n+added line\n context2\n context3";
        let hunks = parse_diff(diff, "test.rs");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].old_count, 3);
        assert_eq!(hunks[0].new_start, 1);
        assert_eq!(hunks[0].new_count, 4);
        assert_eq!(hunks[0].lines.len(), 4);

        // Check line types
        assert!(matches!(hunks[0].lines[0].line_type, LineType::Context));
        assert!(matches!(hunks[0].lines[1].line_type, LineType::Added));
        assert!(matches!(hunks[0].lines[2].line_type, LineType::Context));
    }

    #[test]
    fn test_parse_diff_simple_removal() {
        let diff = "@@ -1,4 +1,3 @@\n context\n-removed line\n context2\n context3";
        let hunks = parse_diff(diff, "test.rs");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].lines.len(), 4);
        assert!(matches!(hunks[0].lines[1].line_type, LineType::Removed));
    }

    #[test]
    fn test_parse_diff_multiple_hunks() {
        let diff = "@@ -1,2 +1,2 @@\n old1\n+new1\n@@ -10,2 +10,2 @@\n old2\n+new2";
        let hunks = parse_diff(diff, "test.rs");
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[1].old_start, 10);
    }

    #[test]
    fn test_parse_diff_line_numbers() {
        let diff = "@@ -5,3 +5,4 @@\n context\n+added\n context2\n context3";
        let hunks = parse_diff(diff, "test.rs");
        let lines = &hunks[0].lines;

        // Context line at position 5 (both old and new)
        assert_eq!(lines[0].old_line_number, Some(5));
        assert_eq!(lines[0].new_line_number, Some(5));

        // Added line - only has new line number
        assert_eq!(lines[1].old_line_number, None);
        assert_eq!(lines[1].new_line_number, Some(6));

        // Next context line
        assert_eq!(lines[2].old_line_number, Some(6));
        assert_eq!(lines[2].new_line_number, Some(7));
    }

    #[test]
    fn test_parse_diff_no_newline_at_eof_marker() {
        // Git shows "\ No newline at end of file" which we should handle gracefully
        let diff = "@@ -1,2 +1,2 @@\n old\n-line1\n+line2\n\\ No newline at end of file";
        let hunks = parse_diff(diff, "test.rs");
        // The backslash line should be ignored (doesn't start with +, -, or space)
        assert_eq!(hunks.len(), 1);
        // Only 3 lines: context, removed, added (backslash line ignored)
        assert_eq!(hunks[0].lines.len(), 3);
    }

    #[test]
    fn test_parse_diff_ignores_file_headers() {
        // Git diff includes --- and +++ headers which should be ignored
        let diff = "--- a/test.rs\n+++ b/test.rs\n@@ -1,1 +1,1 @@\n-old\n+new";
        let hunks = parse_diff(diff, "test.rs");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].lines.len(), 2);
    }

    #[test]
    fn test_hunk_id_is_deterministic() {
        // Same content should produce same hash
        let diff = "@@ -1,1 +1,1 @@\n-old\n+new";
        let hunks1 = parse_diff(diff, "test.rs");
        let hunks2 = parse_diff(diff, "test.rs");
        assert_eq!(hunks1[0].id, hunks2[0].id);
        assert_eq!(hunks1[0].content_hash, hunks2[0].content_hash);
    }

    #[test]
    fn test_hunk_id_differs_by_filepath() {
        // Same content but different filepath should have different id
        let diff = "@@ -1,1 +1,1 @@\n-old\n+new";
        let hunks1 = parse_diff(diff, "test1.rs");
        let hunks2 = parse_diff(diff, "test2.rs");
        assert_ne!(hunks1[0].id, hunks2[0].id);
        // But content_hash should be the same
        assert_eq!(hunks1[0].content_hash, hunks2[0].content_hash);
    }

    #[test]
    fn test_detect_move_pairs() {
        // Create a deletion hunk (code removed from file_a.rs)
        let del_hunk = DiffHunk {
            id: "file_a.rs:abc123".to_string(),
            file_path: "file_a.rs".to_string(),
            old_start: 1,
            old_count: 3,
            new_start: 1,
            new_count: 0,
            content: "fn hello() {\n    println!(\"Hello\");\n}\n".to_string(),
            lines: vec![
                DiffLine {
                    line_type: LineType::Removed,
                    content: "fn hello() {".to_string(),
                    old_line_number: Some(1),
                    new_line_number: None,
                },
                DiffLine {
                    line_type: LineType::Removed,
                    content: "    println!(\"Hello\");".to_string(),
                    old_line_number: Some(2),
                    new_line_number: None,
                },
                DiffLine {
                    line_type: LineType::Removed,
                    content: "}".to_string(),
                    old_line_number: Some(3),
                    new_line_number: None,
                },
            ],
            content_hash: "abc123".to_string(),
            move_pair_id: None,
        };

        // Create an addition hunk (same code added to file_b.rs)
        let add_hunk = DiffHunk {
            id: "file_b.rs:def456".to_string(),
            file_path: "file_b.rs".to_string(),
            old_start: 1,
            old_count: 0,
            new_start: 1,
            new_count: 3,
            content: "fn hello() {\n    println!(\"Hello\");\n}\n".to_string(),
            lines: vec![
                DiffLine {
                    line_type: LineType::Added,
                    content: "fn hello() {".to_string(),
                    old_line_number: None,
                    new_line_number: Some(1),
                },
                DiffLine {
                    line_type: LineType::Added,
                    content: "    println!(\"Hello\");".to_string(),
                    old_line_number: None,
                    new_line_number: Some(2),
                },
                DiffLine {
                    line_type: LineType::Added,
                    content: "}".to_string(),
                    old_line_number: None,
                    new_line_number: Some(3),
                },
            ],
            content_hash: "def456".to_string(),
            move_pair_id: None,
        };

        let mut hunks = vec![del_hunk.clone(), add_hunk.clone()];
        let pairs = detect_move_pairs(&mut hunks);

        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].source_hunk_id, del_hunk.id);
        assert_eq!(pairs[0].dest_hunk_id, add_hunk.id);
        assert_eq!(pairs[0].source_file_path, "file_a.rs");
        assert_eq!(pairs[0].dest_file_path, "file_b.rs");

        // Check that move_pair_id was set on both hunks
        assert_eq!(hunks[0].move_pair_id, Some(add_hunk.id.clone()));
        assert_eq!(hunks[1].move_pair_id, Some(del_hunk.id.clone()));
    }

    #[test]
    fn test_parse_multi_file_diff_empty() {
        let hunks = parse_multi_file_diff("");
        assert!(hunks.is_empty());
    }

    #[test]
    fn test_parse_multi_file_diff_single_file() {
        let diff = "diff --git a/foo.rs b/foo.rs\n--- a/foo.rs\n+++ b/foo.rs\n@@ -1,2 +1,3 @@\n context\n+added\n context2";
        let hunks = parse_multi_file_diff(diff);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].file_path, "foo.rs");
        assert_eq!(hunks[0].lines.len(), 3);
    }

    #[test]
    fn test_parse_multi_file_diff_multiple_files() {
        let diff = "\
diff --git a/foo.rs b/foo.rs
--- a/foo.rs
+++ b/foo.rs
@@ -1,2 +1,3 @@
 context
+added
 context2
diff --git a/bar.rs b/bar.rs
--- a/bar.rs
+++ b/bar.rs
@@ -5,2 +5,2 @@
-old line
+new line
 context";
        let hunks = parse_multi_file_diff(diff);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].file_path, "foo.rs");
        assert_eq!(hunks[1].file_path, "bar.rs");
        assert_eq!(hunks[1].old_start, 5);
    }

    #[test]
    fn test_parse_multi_file_diff_deleted_file() {
        // Deleted files have "+++ /dev/null" — they should be skipped
        let diff = "\
diff --git a/deleted.rs b/deleted.rs
--- a/deleted.rs
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2
diff --git a/kept.rs b/kept.rs
--- a/kept.rs
+++ b/kept.rs
@@ -1,1 +1,1 @@
-old
+new";
        let hunks = parse_multi_file_diff(diff);
        // Only the kept.rs hunk should be present
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].file_path, "kept.rs");
    }
}
