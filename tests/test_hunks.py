"""Tests for hunks module."""

import pytest
from pullapprove_review.hunks import (
    create_untracked_hunk,
    get_hunk_key,
    hash_content,
    map_status_code,
    parse_diff_to_hunks,
    parse_hunk_key,
    parse_name_status,
)


class TestHashContent:
    def test_returns_8_chars(self) -> None:
        result = hash_content("test content")
        assert len(result) == 8

    def test_consistent(self) -> None:
        result1 = hash_content("test content")
        result2 = hash_content("test content")
        assert result1 == result2

    def test_different_content_different_hash(self) -> None:
        result1 = hash_content("content a")
        result2 = hash_content("content b")
        assert result1 != result2


class TestHunkKey:
    def test_get_hunk_key(self) -> None:
        key = get_hunk_key("src/foo.py", "abc12345")
        assert key == "src/foo.py:abc12345"

    def test_parse_hunk_key(self) -> None:
        path, hash_ = parse_hunk_key("src/foo.py:abc12345")
        assert path == "src/foo.py"
        assert hash_ == "abc12345"

    def test_parse_hunk_key_with_colons_in_path(self) -> None:
        path, hash_ = parse_hunk_key("C:/Users/foo/src/bar.py:abc12345")
        assert path == "C:/Users/foo/src/bar.py"
        assert hash_ == "abc12345"

    def test_parse_hunk_key_invalid(self) -> None:
        with pytest.raises(ValueError, match="Invalid hunk key"):
            parse_hunk_key("no_colon_here")


class TestMapStatusCode:
    def test_added(self) -> None:
        assert map_status_code("A") == "added"

    def test_deleted(self) -> None:
        assert map_status_code("D") == "deleted"

    def test_renamed(self) -> None:
        assert map_status_code("R") == "renamed"
        assert map_status_code("R100") == "renamed"

    def test_modified_default(self) -> None:
        assert map_status_code("M") == "modified"
        assert map_status_code("U") == "modified"
        assert map_status_code("") == "modified"


class TestParseNameStatus:
    def test_simple(self) -> None:
        output = """M\tsrc/foo.py
A\tsrc/bar.py
D\tsrc/baz.py"""
        result = parse_name_status(output)
        assert result == {
            "src/foo.py": ("modified", None),
            "src/bar.py": ("added", None),
            "src/baz.py": ("deleted", None),
        }

    def test_rename(self) -> None:
        output = "R100\told/path.py\tnew/path.py"
        result = parse_name_status(output)
        assert result == {
            "new/path.py": ("renamed", "old/path.py"),
        }

    def test_empty(self) -> None:
        result = parse_name_status("")
        assert result == {}


class TestParseDiffToHunks:
    def test_empty_diff(self) -> None:
        files = parse_diff_to_hunks("")
        assert files == []

    def test_single_hunk(self) -> None:
        diff = """diff --git a/src/foo.py b/src/foo.py
index abc123..def456 100644
--- a/src/foo.py
+++ b/src/foo.py
@@ -10,3 +10,5 @@ def foo():
-    old line
+    new line
+    another line"""
        files = parse_diff_to_hunks(diff)
        assert len(files) == 1
        assert files[0].path == "src/foo.py"
        assert len(files[0].hunks) == 1
        assert files[0].hunks[0].start_line == 10
        assert files[0].hunks[0].end_line == 14
        assert "@@ -10,3 +10,5 @@" in files[0].hunks[0].header

    def test_multiple_hunks(self) -> None:
        diff = """diff --git a/src/foo.py b/src/foo.py
index abc123..def456 100644
--- a/src/foo.py
+++ b/src/foo.py
@@ -10,1 +10,1 @@ def foo():
-    old
+    new
@@ -20,1 +20,1 @@ def bar():
-    old2
+    new2"""
        files = parse_diff_to_hunks(diff)
        assert len(files) == 1
        assert len(files[0].hunks) == 2
        assert files[0].hunks[0].start_line == 10
        assert files[0].hunks[1].start_line == 20

    def test_multiple_files(self) -> None:
        diff = """diff --git a/src/foo.py b/src/foo.py
index abc123..def456 100644
--- a/src/foo.py
+++ b/src/foo.py
@@ -10,1 +10,1 @@
-    old
+    new
diff --git a/src/bar.py b/src/bar.py
index abc123..def456 100644
--- a/src/bar.py
+++ b/src/bar.py
@@ -5,1 +5,1 @@
-    old
+    new"""
        files = parse_diff_to_hunks(diff)
        assert len(files) == 2
        assert files[0].path == "src/foo.py"
        assert files[1].path == "src/bar.py"

    def test_with_file_status_map(self) -> None:
        diff = """diff --git a/src/foo.py b/src/foo.py
index abc123..def456 100644
--- a/src/foo.py
+++ b/src/foo.py
@@ -10,1 +10,1 @@
-    old
+    new"""
        status_map = {"src/foo.py": ("added", None)}
        files = parse_diff_to_hunks(diff, status_map)
        assert files[0].status == "added"

    def test_hash_stability(self) -> None:
        """Hashes should be stable across identical content."""
        diff = """diff --git a/src/foo.py b/src/foo.py
index abc123..def456 100644
--- a/src/foo.py
+++ b/src/foo.py
@@ -10,1 +10,1 @@
-    old
+    new"""
        files1 = parse_diff_to_hunks(diff)
        files2 = parse_diff_to_hunks(diff)
        assert files1[0].hunks[0].hash == files2[0].hunks[0].hash

    def test_hash_excludes_line_numbers(self) -> None:
        """Hashes should be based on content, not line numbers."""
        diff1 = """diff --git a/src/foo.py b/src/foo.py
index abc123..def456 100644
--- a/src/foo.py
+++ b/src/foo.py
@@ -10,1 +10,1 @@
-    old
+    new"""
        diff2 = """diff --git a/src/foo.py b/src/foo.py
index abc123..def456 100644
--- a/src/foo.py
+++ b/src/foo.py
@@ -20,1 +20,1 @@
-    old
+    new"""
        files1 = parse_diff_to_hunks(diff1)
        files2 = parse_diff_to_hunks(diff2)
        # Same content, different line numbers - should have same hash
        assert files1[0].hunks[0].hash == files2[0].hunks[0].hash


class TestCreateUntrackedHunk:
    def test_creates_hunk(self) -> None:
        hunk = create_untracked_hunk("src/new.py", "file content")
        assert hunk.file_path == "src/new.py"
        assert hunk.start_line == 1
        assert hunk.end_line == 1
        assert "new file" in hunk.header
        assert len(hunk.hash) == 8

    def test_empty_content_uses_path(self) -> None:
        hunk1 = create_untracked_hunk("src/a.py", "")
        hunk2 = create_untracked_hunk("src/b.py", "")
        # Different paths should produce different hashes
        assert hunk1.hash != hunk2.hash
