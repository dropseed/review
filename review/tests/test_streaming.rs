//! Integration test for streaming grouping.
//!
//! Requires the `claude` CLI to be installed. Run with:
//!   cargo test -p review --test test_streaming -- --nocapture --ignored
//!
//! This exercises the real `run_claude_streaming` and `generate_grouping_streaming`
//! code paths, printing timestamps so you can verify tokens arrive incrementally.

use review::ai::grouping::{generate_grouping_streaming, GroupingInput};
use std::time::Instant;

/// Create a GroupingInput with defaults for optional fields.
fn hunk(
    id: &str,
    file_path: &str,
    content: &str,
    label: Option<Vec<&str>>,
    has_grammar: bool,
) -> GroupingInput {
    GroupingInput {
        id: id.to_owned(),
        file_path: file_path.to_owned(),
        content: content.to_owned(),
        label: label.map(|l| l.into_iter().map(|s| s.to_owned()).collect()),
        symbols: None,
        references: None,
        has_grammar: Some(has_grammar),
    }
}

/// Diagnostic test: dump raw NDJSON lines from claude stream-json to understand the format.
#[test]
#[ignore]
fn test_dump_raw_stream_json() {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::process::{Command, Stdio};

    let Some(claude_path) = review::ai::find_claude_executable() else {
        eprintln!("SKIP: claude CLI not available");
        return;
    };
    eprintln!("Using claude at: {}", claude_path);

    let mut child = Command::new(&claude_path)
        .args([
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--model",
            "haiku",
            "--setting-sources",
            "",
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--allowedTools",
            "none",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_remove("CLAUDECODE")
        .spawn()
        .expect("Failed to spawn claude");

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(b"Say hello world").expect("write stdin");
    }

    let stdout_pipe = child.stdout.take().expect("stdout");
    let stderr_pipe = child.stderr.take();

    let stderr_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut pipe) = stderr_pipe {
            let _ = pipe.read_to_string(&mut buf);
        }
        buf
    });

    let start = Instant::now();
    let reader = BufReader::new(stdout_pipe);
    let mut line_count = 0;

    for line_result in reader.lines() {
        let line = line_result.expect("read line");
        let elapsed = start.elapsed().as_secs_f64();
        line_count += 1;

        // Print first 20 lines in full, then just summarize
        if line_count <= 20 {
            eprintln!(
                "[{:6.2}s] LINE {}: {}",
                elapsed,
                line_count,
                &line[..line.len().min(200)]
            );
        } else if line_count % 50 == 0 {
            eprintln!(
                "[{:6.2}s] LINE {} (... truncating ...)",
                elapsed, line_count
            );
        }
    }

    let stderr = stderr_thread.join().unwrap_or_default();
    let status = child.wait().expect("wait");

    eprintln!("\n--- Summary ---");
    eprintln!("Exit status: {}", status);
    eprintln!("Total lines: {}", line_count);
    if !stderr.trim().is_empty() {
        eprintln!("Stderr: {}", &stderr[..stderr.len().min(500)]);
    }
}

/// Test that `run_claude_streaming` (stream-json mode) actually delivers
/// text deltas incrementally — not all at once at the end.
#[test]
#[ignore]
fn test_stream_json_delivers_tokens_incrementally() {
    if !review::ai::check_claude_available() {
        eprintln!("SKIP: claude CLI not available");
        return;
    }

    let prompt = "Print the numbers 1 through 5, each on its own line. Nothing else.";
    let cwd = std::env::current_dir().unwrap();

    let start = Instant::now();
    let mut chunk_times: Vec<(f64, String)> = Vec::new();

    let result =
        review::ai::run_claude_streaming(prompt, &cwd, "haiku", &["none"], &mut |text: &str| {
            let elapsed = start.elapsed().as_secs_f64();
            let display = text.replace('\n', "↵");
            eprintln!(
                "[{:6.2}s] text delta: {:?}",
                elapsed,
                &display[..display.len().min(80)]
            );
            chunk_times.push((elapsed, text.to_owned()));
        });

    match result {
        Ok(full_output) => {
            eprintln!("\n--- Full output ({} chars) ---", full_output.len());
            eprintln!("{}", &full_output[..full_output.len().min(500)]);
            eprintln!("--- End ---");
            eprintln!("\nReceived {} text deltas", chunk_times.len());

            if chunk_times.len() >= 2 {
                let first = chunk_times.first().unwrap().0;
                let last = chunk_times.last().unwrap().0;
                let spread = last - first;
                eprintln!(
                    "Time spread: {:.2}s (first at {:.2}s, last at {:.2}s)",
                    spread, first, last
                );
            }

            assert!(!full_output.trim().is_empty(), "Output should not be empty");
        }
        Err(e) => {
            eprintln!("ERROR: {:?}", e);
            if !chunk_times.is_empty() {
                eprintln!("(received {} text deltas before error)", chunk_times.len());
            }
            panic!("run_claude_streaming failed: {}", e);
        }
    }
}

/// Test progressive group delivery with enough hunks to produce multiple groups.
///
/// Uses 8 hunks across 4 distinct concerns so the model should produce 3-4 groups.
/// The key assertion: groups arrive at meaningfully different timestamps.
#[test]
#[ignore]
fn test_grouping_streams_multiple_groups_progressively() {
    if !review::ai::check_claude_available() {
        eprintln!("SKIP: claude CLI not available");
        return;
    }

    let hunks = vec![
        // --- Concern 1: New HTTP client feature ---
        hunk(
            "src/client.py:001",
            "src/client.py",
            r#"@@ -1,3 +1,5 @@
+import requests
+from urllib.parse import urljoin
 import os
 import sys
 import json"#,
            Some(vec!["imports:added"]),
            true,
        ),
        hunk(
            "src/client.py:002",
            "src/client.py",
            r#"@@ -20,3 +22,18 @@
+class ApiClient:
+    def __init__(self, base_url: str, token: str):
+        self.base_url = base_url
+        self.session = requests.Session()
+        self.session.headers["Authorization"] = f"Bearer {token}"
+
+    def get(self, path: str) -> dict:
+        url = urljoin(self.base_url, path)
+        response = self.session.get(url)
+        response.raise_for_status()
+        return response.json()
+
+    def post(self, path: str, data: dict) -> dict:
+        url = urljoin(self.base_url, path)
+        response = self.session.post(url, json=data)
+        response.raise_for_status()
+        return response.json()"#,
            None,
            true,
        ),
        // --- Concern 2: Database schema migration ---
        hunk(
            "migrations/003_add_users.sql:003",
            "migrations/003_add_users.sql",
            r#"@@ -0,0 +1,12 @@
+CREATE TABLE users (
+    id SERIAL PRIMARY KEY,
+    email VARCHAR(255) NOT NULL UNIQUE,
+    name VARCHAR(255),
+    created_at TIMESTAMP DEFAULT NOW(),
+    updated_at TIMESTAMP DEFAULT NOW()
+);
+
+CREATE INDEX idx_users_email ON users(email);
+CREATE INDEX idx_users_created_at ON users(created_at);"#,
            None,
            false,
        ),
        hunk(
            "src/models/user.py:004",
            "src/models/user.py",
            r#"@@ -0,0 +1,18 @@
+from dataclasses import dataclass
+from datetime import datetime
+
+@dataclass
+class User:
+    id: int
+    email: str
+    name: str | None
+    created_at: datetime
+    updated_at: datetime
+
+    @classmethod
+    def from_row(cls, row: dict) -> "User":
+        return cls(**row)"#,
            None,
            true,
        ),
        // --- Concern 3: Test infrastructure ---
        hunk(
            "tests/conftest.py:005",
            "tests/conftest.py",
            r#"@@ -5,3 +5,15 @@
+@pytest.fixture
+def mock_api_client():
+    with responses.RequestsMock() as rsps:
+        rsps.add(responses.GET, "https://api.example.com/users",
+                 json={"users": [{"id": 1, "email": "test@example.com"}]})
+        client = ApiClient("https://api.example.com", "test-token")
+        yield client
+
+@pytest.fixture
+def test_db(tmp_path):
+    db_path = tmp_path / "test.db"
+    return setup_test_database(db_path)"#,
            None,
            true,
        ),
        hunk(
            "tests/test_client.py:006",
            "tests/test_client.py",
            r#"@@ -0,0 +1,12 @@
+import pytest
+from src.client import ApiClient
+
+def test_get_users(mock_api_client):
+    users = mock_api_client.get("/users")
+    assert len(users["users"]) == 1
+    assert users["users"][0]["email"] == "test@example.com"
+
+def test_post_creates_resource(mock_api_client):
+    result = mock_api_client.post("/items", {"name": "test"})
+    assert result is not None"#,
            None,
            true,
        ),
        // --- Concern 4: Documentation + config ---
        hunk(
            "README.md:007",
            "README.md",
            r#"@@ -10,3 +10,20 @@
 ## Usage
+
+### API Client
+
+```python
+from src.client import ApiClient
+
+client = ApiClient("https://api.example.com", "your-token")
+users = client.get("/users")
+```
+
+### Database
+
+Run migrations:
+```bash
+python manage.py migrate
+```
+
 ## License"#,
            None,
            false,
        ),
        hunk(
            "pyproject.toml:008",
            "pyproject.toml",
            r#"@@ -12,3 +12,6 @@
 dependencies = [
+    "requests>=2.31.0",
+    "psycopg2-binary>=2.9.0",
+    "pytest>=7.0.0",
 ]"#,
            None,
            false,
        ),
    ];

    let all_ids: Vec<String> = hunks.iter().map(|h| h.id.clone()).collect();
    let cwd = std::env::current_dir().unwrap();
    let start = Instant::now();
    let mut group_times: Vec<(f64, String)> = Vec::new();

    eprintln!(
        "Starting grouping streaming with {} hunks...\n",
        hunks.len()
    );

    let result = generate_grouping_streaming(&hunks, &cwd, &[], &mut |group| {
        let elapsed = start.elapsed().as_secs_f64();
        eprintln!(
            "[{:6.2}s] GROUP: \"{}\" (phase: {:?}) → {:?}",
            elapsed, group.title, group.phase, group.hunk_ids,
        );
        group_times.push((elapsed, group.title.clone()));
    });

    match result {
        Ok(groups) => {
            let total_time = start.elapsed().as_secs_f64();
            eprintln!(
                "\n--- Result: {} groups in {:.1}s ---",
                groups.len(),
                total_time
            );
            for g in &groups {
                eprintln!(
                    "  • {} [phase: {:?}] ({} hunks)",
                    g.title,
                    g.phase,
                    g.hunk_ids.len()
                );
            }

            assert!(
                groups.len() >= 2,
                "Should produce at least 2 groups, got {}",
                groups.len()
            );

            // Verify phases are present
            let groups_with_phase = groups.iter().filter(|g| g.phase.is_some()).count();
            eprintln!(
                "\nPhase coverage: {}/{} groups have a phase",
                groups_with_phase,
                groups.len()
            );
            assert!(
                groups_with_phase > groups.len() / 2,
                "Most groups should have a phase, but only {}/{} do",
                groups_with_phase,
                groups.len(),
            );

            // Verify all hunk IDs are covered
            let mut covered: Vec<String> = groups
                .iter()
                .flat_map(|g| g.hunk_ids.iter().cloned())
                .collect();
            covered.sort();
            let mut expected = all_ids;
            expected.sort();
            assert_eq!(covered, expected, "All hunk IDs should be covered");

            // Check progressive delivery
            if group_times.len() >= 2 {
                let first = group_times.first().unwrap().0;
                let last = group_times.last().unwrap().0;
                let spread = last - first;
                eprintln!(
                    "\nStreaming spread: {:.2}s (first group at {:.2}s, last at {:.2}s)",
                    spread, first, last
                );
                if spread > 0.5 {
                    eprintln!("PASS: Groups arrived progressively!");
                } else {
                    eprintln!(
                        "NOTE: Groups arrived close together ({:.2}s spread)",
                        spread
                    );
                }
            }
        }
        Err(e) => {
            eprintln!("ERROR: {:?}", e);
            if !group_times.is_empty() {
                eprintln!("(received {} groups before error)", group_times.len());
            }
            panic!("generate_grouping_streaming failed: {}", e);
        }
    }
}
