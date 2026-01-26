use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustPattern {
    pub id: String,
    pub category: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustCategory {
    pub id: String,
    pub name: String,
    pub description: String,
    pub patterns: Vec<TrustPattern>,
}

/// The full taxonomy of trust patterns
pub fn get_trust_taxonomy() -> Vec<TrustCategory> {
    vec![
        TrustCategory {
            id: "imports".to_string(),
            name: "Imports".to_string(),
            description: "Changes to import statements".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "imports:added".to_string(),
                    category: "imports".to_string(),
                    name: "Added".to_string(),
                    description: "New import statements added".to_string(),
                },
                TrustPattern {
                    id: "imports:removed".to_string(),
                    category: "imports".to_string(),
                    name: "Removed".to_string(),
                    description: "Import statements removed".to_string(),
                },
                TrustPattern {
                    id: "imports:reordered".to_string(),
                    category: "imports".to_string(),
                    name: "Reordered".to_string(),
                    description: "Import statements reordered".to_string(),
                },
            ],
        },
        TrustCategory {
            id: "formatting".to_string(),
            name: "Formatting".to_string(),
            description: "Code style and formatting changes".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "formatting:whitespace".to_string(),
                    category: "formatting".to_string(),
                    name: "Whitespace".to_string(),
                    description: "Whitespace-only changes (spaces, tabs, blank lines)".to_string(),
                },
                TrustPattern {
                    id: "formatting:line-length".to_string(),
                    category: "formatting".to_string(),
                    name: "Line length".to_string(),
                    description: "Line wrapping for length limits".to_string(),
                },
                TrustPattern {
                    id: "formatting:style".to_string(),
                    category: "formatting".to_string(),
                    name: "Style".to_string(),
                    description: "Code style changes (semicolons, quotes, etc.)".to_string(),
                },
            ],
        },
        TrustCategory {
            id: "comments".to_string(),
            name: "Comments".to_string(),
            description: "Changes to code comments".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "comments:added".to_string(),
                    category: "comments".to_string(),
                    name: "Added".to_string(),
                    description: "New comments added".to_string(),
                },
                TrustPattern {
                    id: "comments:removed".to_string(),
                    category: "comments".to_string(),
                    name: "Removed".to_string(),
                    description: "Comments removed".to_string(),
                },
                TrustPattern {
                    id: "comments:modified".to_string(),
                    category: "comments".to_string(),
                    name: "Modified".to_string(),
                    description: "Comments updated or corrected".to_string(),
                },
            ],
        },
        TrustCategory {
            id: "types".to_string(),
            name: "Types".to_string(),
            description: "Type annotation changes".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "types:added".to_string(),
                    category: "types".to_string(),
                    name: "Added".to_string(),
                    description: "Type annotations added".to_string(),
                },
                TrustPattern {
                    id: "types:modified".to_string(),
                    category: "types".to_string(),
                    name: "Modified".to_string(),
                    description: "Type annotations changed".to_string(),
                },
                TrustPattern {
                    id: "types:removed".to_string(),
                    category: "types".to_string(),
                    name: "Removed".to_string(),
                    description: "Type annotations removed".to_string(),
                },
            ],
        },
        TrustCategory {
            id: "file".to_string(),
            name: "File".to_string(),
            description: "File-level operations".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "file:deleted".to_string(),
                    category: "file".to_string(),
                    name: "Deleted".to_string(),
                    description: "Entire file deleted".to_string(),
                },
                TrustPattern {
                    id: "file:renamed".to_string(),
                    category: "file".to_string(),
                    name: "Renamed".to_string(),
                    description: "File renamed".to_string(),
                },
                TrustPattern {
                    id: "file:moved".to_string(),
                    category: "file".to_string(),
                    name: "Moved".to_string(),
                    description: "File moved to different directory".to_string(),
                },
            ],
        },
        TrustCategory {
            id: "generated".to_string(),
            name: "Generated".to_string(),
            description: "Auto-generated content".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "generated:lockfile".to_string(),
                    category: "generated".to_string(),
                    name: "Lock file".to_string(),
                    description: "Package lock files (package-lock.json, yarn.lock, etc.)"
                        .to_string(),
                },
                TrustPattern {
                    id: "generated:build".to_string(),
                    category: "generated".to_string(),
                    name: "Build output".to_string(),
                    description: "Build artifacts and generated code".to_string(),
                },
                TrustPattern {
                    id: "generated:schema".to_string(),
                    category: "generated".to_string(),
                    name: "Schema".to_string(),
                    description: "Generated schema files".to_string(),
                },
            ],
        },
        TrustCategory {
            id: "rename".to_string(),
            name: "Rename".to_string(),
            description: "Identifier renaming".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "rename:variable".to_string(),
                    category: "rename".to_string(),
                    name: "Variable".to_string(),
                    description: "Variable renamed".to_string(),
                },
                TrustPattern {
                    id: "rename:function".to_string(),
                    category: "rename".to_string(),
                    name: "Function".to_string(),
                    description: "Function or method renamed".to_string(),
                },
                TrustPattern {
                    id: "rename:class".to_string(),
                    category: "rename".to_string(),
                    name: "Class".to_string(),
                    description: "Class or type renamed".to_string(),
                },
            ],
        },
        TrustCategory {
            id: "code".to_string(),
            name: "Code".to_string(),
            description: "Code movement and structure".to_string(),
            patterns: vec![TrustPattern {
                id: "code:extracted".to_string(),
                category: "code".to_string(),
                name: "Extracted".to_string(),
                description: "Code extracted to separate function/module".to_string(),
            }],
        },
        TrustCategory {
            id: "version".to_string(),
            name: "Version".to_string(),
            description: "Version number changes".to_string(),
            patterns: vec![TrustPattern {
                id: "version:bumped".to_string(),
                category: "version".to_string(),
                name: "Bumped".to_string(),
                description: "Version number incremented".to_string(),
            }],
        },
        TrustCategory {
            id: "remove".to_string(),
            name: "Remove".to_string(),
            description: "Code removal".to_string(),
            patterns: vec![
                TrustPattern {
                    id: "remove:deprecated".to_string(),
                    category: "remove".to_string(),
                    name: "Deprecated".to_string(),
                    description: "Deprecated code removed".to_string(),
                },
                TrustPattern {
                    id: "remove:dead-code".to_string(),
                    category: "remove".to_string(),
                    name: "Dead code".to_string(),
                    description: "Unreachable or unused code removed".to_string(),
                },
            ],
        },
    ]
}
