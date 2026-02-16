//! Symbol extraction from source files using tree-sitter.
//!
//! Parses source files to extract symbol definitions (functions, classes,
//! structs, traits, etc.) and maps diff hunks to the symbols they affect.

pub mod cache;
pub mod extractor;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The kind of symbol extracted from source code.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Function,
    Class,
    Struct,
    Trait,
    Impl,
    Method,
    Enum,
    Interface,
    Module,
    Type,
}

/// A symbol definition extracted from a source file.
#[derive(Debug, Clone, Serialize)]
pub struct Symbol {
    pub name: String,
    pub kind: SymbolKind,
    #[serde(rename = "startLine")]
    pub start_line: u32,
    #[serde(rename = "endLine")]
    pub end_line: u32,
    pub children: Vec<Symbol>,
}

/// A symbol definition found via name lookup (includes file path).
#[derive(Debug, Clone, Serialize)]
pub struct SymbolDefinition {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub name: String,
    pub kind: SymbolKind,
    #[serde(rename = "startLine")]
    pub start_line: u32,
    #[serde(rename = "endLine")]
    pub end_line: u32,
}

/// Maps symbols to hunks for a single file.
#[derive(Debug, Clone, Serialize)]
pub struct FileSymbolMap {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub symbols: Vec<Symbol>,
    /// Mapping from hunk ID to the names of symbols it overlaps.
    #[serde(rename = "hunkSymbols")]
    pub hunk_symbols: HashMap<String, Vec<String>>,
    /// Hunk IDs that don't fall within any symbol.
    #[serde(rename = "topLevelHunkIds")]
    pub top_level_hunk_ids: Vec<String>,
    /// Whether a tree-sitter grammar was available for this file.
    #[serde(rename = "hasGrammar")]
    pub has_grammar: bool,
}

/// Whether a symbol was added, removed, or modified.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SymbolChangeType {
    Added,
    Removed,
    Modified,
}

/// A line range within a file (1-based, inclusive).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineRange {
    #[serde(rename = "startLine")]
    pub start_line: u32,
    #[serde(rename = "endLine")]
    pub end_line: u32,
}

/// A symbol that has changed between old and new versions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolDiff {
    pub name: String,
    pub kind: Option<SymbolKind>,
    #[serde(rename = "changeType")]
    pub change_type: SymbolChangeType,
    #[serde(rename = "hunkIds")]
    pub hunk_ids: Vec<String>,
    pub children: Vec<SymbolDiff>,
    #[serde(rename = "oldRange")]
    pub old_range: Option<LineRange>,
    #[serde(rename = "newRange")]
    pub new_range: Option<LineRange>,
}

/// A reference to a modified symbol found within a hunk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolReference {
    #[serde(rename = "symbolName")]
    pub symbol_name: String,
    /// The hunk containing the reference.
    #[serde(rename = "hunkId")]
    pub hunk_id: String,
    /// 1-based line numbers where the reference appears within the hunk.
    #[serde(rename = "lineNumbers")]
    pub line_numbers: Vec<u32>,
}

/// Symbol-level diff for a single file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSymbolDiff {
    #[serde(rename = "filePath")]
    pub file_path: String,
    /// Only changed symbols (added/removed/modified).
    pub symbols: Vec<SymbolDiff>,
    /// Hunks that don't fall within any symbol.
    #[serde(rename = "topLevelHunkIds")]
    pub top_level_hunk_ids: Vec<String>,
    /// Whether a tree-sitter grammar was available for this file.
    #[serde(rename = "hasGrammar")]
    pub has_grammar: bool,
    /// References to modified symbols found in hunks of this file.
    #[serde(rename = "symbolReferences")]
    pub symbol_references: Vec<SymbolReference>,
}
