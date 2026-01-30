//! Tree-sitter based symbol extraction and hunk mapping.

use super::{FileSymbolDiff, LineRange, Symbol, SymbolChangeType, SymbolDiff, SymbolKind};
use crate::diff::parser::DiffHunk;
use std::collections::HashMap;
use tree_sitter::{Language, Node, Parser};

/// Get the tree-sitter language for a file based on its extension.
pub fn get_language_for_file(file_path: &str) -> Option<Language> {
    let ext = file_path.rsplit('.').next()?.to_lowercase();
    match ext.as_str() {
        #[cfg(feature = "symbols-rust-lang")]
        "rs" => Some(tree_sitter_rust::LANGUAGE.into()),
        #[cfg(feature = "symbols-typescript")]
        "js" | "jsx" | "mjs" | "cjs" => Some(tree_sitter_javascript::LANGUAGE.into()),
        #[cfg(feature = "symbols-typescript")]
        "ts" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        #[cfg(feature = "symbols-typescript")]
        "tsx" => Some(tree_sitter_typescript::LANGUAGE_TSX.into()),
        #[cfg(feature = "symbols-python")]
        "py" | "pyi" => Some(tree_sitter_python::LANGUAGE.into()),
        #[cfg(feature = "symbols-go")]
        "go" => Some(tree_sitter_go::LANGUAGE.into()),
        #[cfg(feature = "symbols-ruby")]
        "rb" => Some(tree_sitter_ruby::LANGUAGE.into()),
        #[cfg(feature = "symbols-java")]
        "java" => Some(tree_sitter_java::LANGUAGE.into()),
        #[cfg(feature = "symbols-c")]
        "c" | "h" => Some(tree_sitter_c::LANGUAGE.into()),
        #[cfg(feature = "symbols-cpp")]
        "cpp" | "cc" | "cxx" | "hpp" | "hxx" | "hh" => Some(tree_sitter_cpp::LANGUAGE.into()),
        #[cfg(feature = "symbols-csharp")]
        "cs" => Some(tree_sitter_c_sharp::LANGUAGE.into()),
        #[cfg(feature = "symbols-php")]
        "php" => Some(tree_sitter_php::LANGUAGE_PHP.into()),
        #[cfg(feature = "symbols-css")]
        "css" => Some(tree_sitter_css::LANGUAGE.into()),
        #[cfg(feature = "symbols-html")]
        "html" | "htm" => Some(tree_sitter_html::LANGUAGE.into()),
        #[cfg(feature = "symbols-markdown")]
        "md" | "markdown" | "mdx" => Some(tree_sitter_md::LANGUAGE.into()),
        _ => None,
    }
}

/// Extract symbols from source code using tree-sitter.
pub fn extract_symbols(source: &str, file_path: &str) -> Option<Vec<Symbol>> {
    let language = get_language_for_file(file_path)?;
    let mut parser = Parser::new();
    parser.set_language(&language).ok()?;

    let tree = parser.parse(source, None)?;
    let root = tree.root_node();

    let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();
    Some(extract_symbols_from_node(root, source, &ext))
}

/// Recursively extract symbol definitions from a tree-sitter node.
fn extract_symbols_from_node(node: Node, source: &str, ext: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(symbol) = node_to_symbol(child, source, ext) {
            symbols.push(symbol);
        } else {
            // For languages like HTML/Markdown where symbols are deeply nested,
            // recurse into unmatched nodes to find symbols at any depth.
            #[cfg(feature = "symbols-html")]
            if matches!(ext, "html" | "htm") {
                symbols.extend(extract_symbols_from_node(child, source, ext));
            }
            #[cfg(feature = "symbols-markdown")]
            if matches!(ext, "md" | "markdown" | "mdx") {
                symbols.extend(extract_symbols_from_node(child, source, ext));
            }
        }
    }

    symbols
}

/// Try to convert a tree-sitter node into a Symbol.
fn node_to_symbol(node: Node, source: &str, ext: &str) -> Option<Symbol> {
    let kind_str = node.kind();

    match ext {
        #[cfg(feature = "symbols-rust-lang")]
        "rs" => rust_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-typescript")]
        "js" | "jsx" | "mjs" | "cjs" | "ts" | "tsx" => js_ts_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-python")]
        "py" | "pyi" => python_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-go")]
        "go" => go_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-ruby")]
        "rb" => ruby_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-java")]
        "java" => java_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-c")]
        "c" | "h" => c_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-cpp")]
        "cpp" | "cc" | "cxx" | "hpp" | "hxx" | "hh" => cpp_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-csharp")]
        "cs" => csharp_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-php")]
        "php" => php_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-css")]
        "css" => css_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-html")]
        "html" | "htm" => html_node_to_symbol(node, source, kind_str),
        #[cfg(feature = "symbols-markdown")]
        "md" | "markdown" | "mdx" => markdown_node_to_symbol(node, source, kind_str),
        _ => None,
    }
}

// --- Rust ---

#[cfg(feature = "symbols-rust-lang")]
fn rust_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "function_item" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "struct_item" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Struct,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "enum_item" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Enum,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "trait_item" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_methods_from_body(node, source, "rs");
            Some(Symbol {
                name,
                kind: SymbolKind::Trait,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "impl_item" => {
            let name = find_impl_name(node, source)?;
            let children = extract_methods_from_body(node, source, "rs");
            Some(Symbol {
                name,
                kind: SymbolKind::Impl,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "type_item" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Type,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "mod_item" => {
            let name = find_child_text(node, "name", source)?;
            // Only include modules with a body (inline modules)
            if node.child_by_field_name("body").is_some() {
                let children = extract_symbols_from_body(node, source, "rs");
                Some(Symbol {
                    name,
                    kind: SymbolKind::Module,
                    start_line: node.start_position().row as u32 + 1,
                    end_line: node.end_position().row as u32 + 1,
                    children,
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

// --- JavaScript / TypeScript ---

#[cfg(feature = "symbols-typescript")]
fn js_ts_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "function_declaration" | "generator_function_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "class_declaration" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_class_methods_js(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Class,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "interface_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Interface,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "type_alias_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Type,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "enum_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Enum,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "export_statement" => {
            // Look inside export for declarations
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if let Some(sym) = js_ts_node_to_symbol(child, source, child.kind()) {
                    return Some(sym);
                }
            }
            None
        }
        "lexical_declaration" | "variable_declaration" => {
            // Match `const foo = function/arrow_function` patterns
            extract_variable_function(node, source)
        }
        _ => None,
    }
}

/// Extract function names from const/let/var declarations with arrow/function expressions.
#[cfg(feature = "symbols-typescript")]
fn extract_variable_function(node: Node, source: &str) -> Option<Symbol> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator" {
            let name = find_child_text(child, "name", source)?;
            let value = child.child_by_field_name("value")?;
            match value.kind() {
                "arrow_function" | "function_expression" | "function" => {
                    return Some(Symbol {
                        name,
                        kind: SymbolKind::Function,
                        start_line: node.start_position().row as u32 + 1,
                        end_line: node.end_position().row as u32 + 1,
                        children: vec![],
                    });
                }
                _ => {}
            }
        }
    }
    None
}

/// Extract methods from a JS/TS class body.
#[cfg(feature = "symbols-typescript")]
fn extract_class_methods_js(class_node: Node, source: &str) -> Vec<Symbol> {
    let mut methods = Vec::new();
    let Some(body) = class_node.child_by_field_name("body") else {
        return methods;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        match child.kind() {
            "method_definition" | "public_field_definition" => {
                if let Some(name) = find_child_text(child, "name", source) {
                    methods.push(Symbol {
                        name,
                        kind: SymbolKind::Method,
                        start_line: child.start_position().row as u32 + 1,
                        end_line: child.end_position().row as u32 + 1,
                        children: vec![],
                    });
                }
            }
            _ => {}
        }
    }

    methods
}

// --- Python ---

#[cfg(feature = "symbols-python")]
fn python_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "function_definition" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "class_definition" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_python_methods(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Class,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "decorated_definition" => {
            // Look at the definition inside the decorator
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if let Some(mut sym) = python_node_to_symbol(child, source, child.kind()) {
                    // Use the decorator's start line since it's part of the definition
                    sym.start_line = node.start_position().row as u32 + 1;
                    return Some(sym);
                }
            }
            None
        }
        _ => None,
    }
}

#[cfg(feature = "symbols-python")]
fn extract_python_methods(class_node: Node, source: &str) -> Vec<Symbol> {
    let mut methods = Vec::new();
    let Some(body) = class_node.child_by_field_name("body") else {
        return methods;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        match child.kind() {
            "function_definition" => {
                if let Some(name) = find_child_text(child, "name", source) {
                    methods.push(Symbol {
                        name,
                        kind: SymbolKind::Method,
                        start_line: child.start_position().row as u32 + 1,
                        end_line: child.end_position().row as u32 + 1,
                        children: vec![],
                    });
                }
            }
            "decorated_definition" => {
                let mut inner_cursor = child.walk();
                for inner in child.children(&mut inner_cursor) {
                    if inner.kind() == "function_definition" {
                        if let Some(name) = find_child_text(inner, "name", source) {
                            methods.push(Symbol {
                                name,
                                kind: SymbolKind::Method,
                                start_line: child.start_position().row as u32 + 1,
                                end_line: child.end_position().row as u32 + 1,
                                children: vec![],
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }

    methods
}

// --- Go ---

#[cfg(feature = "symbols-go")]
fn go_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "function_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "method_declaration" => {
            let name = find_child_text(node, "name", source)?;
            // Include receiver in name for Go methods
            let receiver = extract_go_receiver(node, source).unwrap_or_default();

            let full_name = if receiver.is_empty() {
                name
            } else {
                format!("({receiver}).{name}")
            };

            Some(Symbol {
                name: full_name,
                kind: SymbolKind::Method,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "type_declaration" => {
            // Go type declarations contain type_spec children
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "type_spec" {
                    let name = find_child_text(child, "name", source)?;
                    let type_node = child.child_by_field_name("type")?;
                    let kind = match type_node.kind() {
                        "struct_type" => SymbolKind::Struct,
                        "interface_type" => SymbolKind::Interface,
                        _ => SymbolKind::Type,
                    };
                    return Some(Symbol {
                        name,
                        kind,
                        start_line: node.start_position().row as u32 + 1,
                        end_line: node.end_position().row as u32 + 1,
                        children: vec![],
                    });
                }
            }
            None
        }
        _ => None,
    }
}

/// Extract Go receiver type name from a method declaration.
#[cfg(feature = "symbols-go")]
fn extract_go_receiver(node: Node, source: &str) -> Option<String> {
    let receiver = node.child_by_field_name("receiver")?;
    let mut cursor = receiver.walk();
    for child in receiver.children(&mut cursor) {
        if child.kind() == "parameter_declaration" {
            if let Some(type_node) = child.child_by_field_name("type") {
                let text = node_text(type_node, source);
                return Some(text.trim_start_matches('*').to_owned());
            }
        }
    }
    None
}

// --- Ruby ---

#[cfg(feature = "symbols-ruby")]
fn ruby_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "method" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "singleton_method" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name: format!("self.{name}"),
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "class" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_ruby_methods(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Class,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "module" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_ruby_body_symbols(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Module,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        _ => None,
    }
}

#[cfg(feature = "symbols-ruby")]
fn extract_ruby_methods(node: Node, source: &str) -> Vec<Symbol> {
    let mut methods = Vec::new();
    let Some(body) = node.child_by_field_name("body") else {
        return methods;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        match child.kind() {
            "method" => {
                if let Some(name) = find_child_text(child, "name", source) {
                    methods.push(Symbol {
                        name,
                        kind: SymbolKind::Method,
                        start_line: child.start_position().row as u32 + 1,
                        end_line: child.end_position().row as u32 + 1,
                        children: vec![],
                    });
                }
            }
            "singleton_method" => {
                if let Some(name) = find_child_text(child, "name", source) {
                    methods.push(Symbol {
                        name: format!("self.{name}"),
                        kind: SymbolKind::Method,
                        start_line: child.start_position().row as u32 + 1,
                        end_line: child.end_position().row as u32 + 1,
                        children: vec![],
                    });
                }
            }
            _ => {}
        }
    }

    methods
}

#[cfg(feature = "symbols-ruby")]
fn extract_ruby_body_symbols(node: Node, source: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    let Some(body) = node.child_by_field_name("body") else {
        return symbols;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        if let Some(sym) = ruby_node_to_symbol(child, source, child.kind()) {
            symbols.push(sym);
        }
    }

    symbols
}

// --- Java ---

#[cfg(feature = "symbols-java")]
fn java_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "class_declaration" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_java_members(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Class,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "interface_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Interface,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "method_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Method,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "enum_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Enum,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        _ => None,
    }
}

#[cfg(feature = "symbols-java")]
fn extract_java_members(node: Node, source: &str) -> Vec<Symbol> {
    let mut members = Vec::new();
    let Some(body) = node.child_by_field_name("body") else {
        return members;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        if child.kind() == "method_declaration" {
            if let Some(name) = find_child_text(child, "name", source) {
                members.push(Symbol {
                    name,
                    kind: SymbolKind::Method,
                    start_line: child.start_position().row as u32 + 1,
                    end_line: child.end_position().row as u32 + 1,
                    children: vec![],
                });
            }
        }
    }

    members
}

// --- C ---

#[cfg(feature = "symbols-c")]
fn c_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "function_definition" => {
            let declarator = node.child_by_field_name("declarator")?;
            let name = find_function_declarator_name(declarator, source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "struct_specifier" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Struct,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "enum_specifier" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Enum,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "type_definition" => {
            let name = find_child_text(node, "declarator", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Type,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "declaration" => {
            // Check for forward declarations of structs/enums at top level
            // (only match if there's a struct/enum specifier with a body)
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                match child.kind() {
                    "struct_specifier" | "enum_specifier" => {
                        if child.child_by_field_name("body").is_some() {
                            return c_node_to_symbol(child, source, child.kind());
                        }
                    }
                    _ => {}
                }
            }
            None
        }
        _ => None,
    }
}

/// Extract the function name from a C/C++ function declarator (may be nested in pointer_declarator).
#[cfg(any(feature = "symbols-c", feature = "symbols-cpp"))]
fn find_function_declarator_name(node: Node, source: &str) -> Option<String> {
    match node.kind() {
        "function_declarator" => find_child_text(node, "declarator", source),
        "pointer_declarator" => {
            let inner = node.child_by_field_name("declarator")?;
            find_function_declarator_name(inner, source)
        }
        _ => Some(node_text(node, source).to_owned()),
    }
}

// --- C++ ---

#[cfg(feature = "symbols-cpp")]
fn cpp_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "function_definition" => {
            let declarator = node.child_by_field_name("declarator")?;
            let name = find_function_declarator_name(declarator, source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "class_specifier" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_cpp_class_members(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Class,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "struct_specifier" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Struct,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "enum_specifier" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Enum,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "namespace_definition" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_cpp_namespace_symbols(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Module,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "declaration" => {
            // Check for struct/class/enum declarations with bodies
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                match child.kind() {
                    "class_specifier" | "struct_specifier" | "enum_specifier" => {
                        if child.child_by_field_name("body").is_some() {
                            return cpp_node_to_symbol(child, source, child.kind());
                        }
                    }
                    _ => {}
                }
            }
            None
        }
        _ => None,
    }
}

#[cfg(feature = "symbols-cpp")]
fn extract_cpp_class_members(node: Node, source: &str) -> Vec<Symbol> {
    let mut members = Vec::new();
    let Some(body) = node.child_by_field_name("body") else {
        return members;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        match child.kind() {
            "function_definition" => {
                if let Some(declarator) = child.child_by_field_name("declarator") {
                    if let Some(name) = find_function_declarator_name(declarator, source) {
                        members.push(Symbol {
                            name,
                            kind: SymbolKind::Method,
                            start_line: child.start_position().row as u32 + 1,
                            end_line: child.end_position().row as u32 + 1,
                            children: vec![],
                        });
                    }
                }
            }
            "declaration" => {
                // Method declarations (not definitions)
                let mut inner_cursor = child.walk();
                for inner in child.children(&mut inner_cursor) {
                    if inner.kind() == "function_declarator" {
                        if let Some(name) = find_child_text(inner, "declarator", source) {
                            members.push(Symbol {
                                name,
                                kind: SymbolKind::Method,
                                start_line: child.start_position().row as u32 + 1,
                                end_line: child.end_position().row as u32 + 1,
                                children: vec![],
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }

    members
}

#[cfg(feature = "symbols-cpp")]
fn extract_cpp_namespace_symbols(node: Node, source: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    let Some(body) = node.child_by_field_name("body") else {
        return symbols;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        if let Some(sym) = cpp_node_to_symbol(child, source, child.kind()) {
            symbols.push(sym);
        }
    }

    symbols
}

// --- C# ---

#[cfg(feature = "symbols-csharp")]
fn csharp_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "class_declaration" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_csharp_members(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Class,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "interface_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Interface,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "method_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Method,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "struct_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Struct,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "enum_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Enum,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "namespace_declaration" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_csharp_namespace_symbols(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Module,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        _ => None,
    }
}

#[cfg(feature = "symbols-csharp")]
fn extract_csharp_members(node: Node, source: &str) -> Vec<Symbol> {
    let mut members = Vec::new();
    let Some(body) = node.child_by_field_name("body") else {
        return members;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        if child.kind() == "method_declaration" {
            if let Some(name) = find_child_text(child, "name", source) {
                members.push(Symbol {
                    name,
                    kind: SymbolKind::Method,
                    start_line: child.start_position().row as u32 + 1,
                    end_line: child.end_position().row as u32 + 1,
                    children: vec![],
                });
            }
        }
    }

    members
}

#[cfg(feature = "symbols-csharp")]
fn extract_csharp_namespace_symbols(node: Node, source: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    let Some(body) = node.child_by_field_name("body") else {
        return symbols;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        if let Some(sym) = csharp_node_to_symbol(child, source, child.kind()) {
            symbols.push(sym);
        }
    }

    symbols
}

// --- PHP ---

#[cfg(feature = "symbols-php")]
fn php_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "class_declaration" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_php_members(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Class,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "function_definition" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "method_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Method,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "interface_declaration" => {
            let name = find_child_text(node, "name", source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Interface,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "trait_declaration" => {
            let name = find_child_text(node, "name", source)?;
            let children = extract_php_members(node, source);
            Some(Symbol {
                name,
                kind: SymbolKind::Trait,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children,
            })
        }
        "program" => {
            // PHP wraps everything in a program node; recurse into children
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if let Some(sym) = php_node_to_symbol(child, source, child.kind()) {
                    return Some(sym);
                }
            }
            None
        }
        _ => None,
    }
}

#[cfg(feature = "symbols-php")]
fn extract_php_members(node: Node, source: &str) -> Vec<Symbol> {
    let mut members = Vec::new();
    let Some(body) = node.child_by_field_name("body") else {
        return members;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        if child.kind() == "method_declaration" {
            if let Some(name) = find_child_text(child, "name", source) {
                members.push(Symbol {
                    name,
                    kind: SymbolKind::Method,
                    start_line: child.start_position().row as u32 + 1,
                    end_line: child.end_position().row as u32 + 1,
                    children: vec![],
                });
            }
        }
    }

    members
}

// --- CSS ---

#[cfg(feature = "symbols-css")]
fn css_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "rule_set" => {
            // Extract the selector text as the symbol name
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "selectors" {
                    let name = node_text(child, source).to_owned();
                    return Some(Symbol {
                        name,
                        kind: SymbolKind::Function,
                        start_line: node.start_position().row as u32 + 1,
                        end_line: node.end_position().row as u32 + 1,
                        children: vec![],
                    });
                }
            }
            None
        }
        "media_statement" => {
            // Use the full @media text up to the block as the name
            let name = extract_css_at_rule_name(node, source)?;
            Some(Symbol {
                name,
                kind: SymbolKind::Module,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "keyframes_statement" => {
            // Try the "name" field first, then walk children for "keyframes_name" node
            let name_node = if let Some(n) = node.child_by_field_name("name") {
                Some(n)
            } else {
                let mut cursor = node.walk();
                let found = node
                    .children(&mut cursor)
                    .find(|c| c.kind() == "keyframes_name");
                found
            };
            let name = node_text(name_node?, source).to_owned();
            Some(Symbol {
                name,
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        _ => None,
    }
}

#[cfg(feature = "symbols-css")]
fn extract_css_at_rule_name(node: Node, source: &str) -> Option<String> {
    // Get text from node start to just before the block
    let full_text = node_text(node, source);
    // Find the opening brace and take everything before it
    if let Some(pos) = full_text.find('{') {
        let name = full_text[..pos].trim().to_owned();
        if name.is_empty() {
            None
        } else {
            Some(name)
        }
    } else {
        Some(full_text.trim().to_owned())
    }
}

// --- HTML ---

#[cfg(feature = "symbols-html")]
fn html_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "element" => {
            // Only extract elements with an id attribute
            // Find the start_tag child (it's a child node, not a named field)
            let mut cursor = node.walk();
            let start_tag = node
                .children(&mut cursor)
                .find(|c| c.kind() == "start_tag")?;
            let id = extract_html_id_attribute(start_tag, source)?;
            Some(Symbol {
                name: id,
                kind: SymbolKind::Function,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        "script_element" => Some(Symbol {
            name: "<script>".to_owned(),
            kind: SymbolKind::Module,
            start_line: node.start_position().row as u32 + 1,
            end_line: node.end_position().row as u32 + 1,
            children: vec![],
        }),
        "style_element" => Some(Symbol {
            name: "<style>".to_owned(),
            kind: SymbolKind::Module,
            start_line: node.start_position().row as u32 + 1,
            end_line: node.end_position().row as u32 + 1,
            children: vec![],
        }),
        _ => None,
    }
}

#[cfg(feature = "symbols-html")]
fn extract_html_id_attribute(start_tag: Node, source: &str) -> Option<String> {
    let mut cursor = start_tag.walk();
    for child in start_tag.children(&mut cursor) {
        if child.kind() == "attribute" {
            // In tree-sitter-html, attribute children are: attribute_name, "=", quoted_attribute_value
            let mut attr_cursor = child.walk();
            let mut attr_name = None;
            let mut attr_value = None;
            for attr_child in child.children(&mut attr_cursor) {
                match attr_child.kind() {
                    "attribute_name" => attr_name = Some(node_text(attr_child, source)),
                    "quoted_attribute_value" => {
                        // The value inside quotes: find the attribute_value child
                        let mut val_cursor = attr_child.walk();
                        for val_child in attr_child.children(&mut val_cursor) {
                            if val_child.kind() == "attribute_value" {
                                attr_value = Some(node_text(val_child, source));
                            }
                        }
                        // Fallback: use the full text minus quotes
                        if attr_value.is_none() {
                            let full = node_text(attr_child, source);
                            attr_value = Some(full.trim_matches('"').trim_matches('\''));
                        }
                    }
                    _ => {}
                }
            }
            if attr_name == Some("id") {
                if let Some(val) = attr_value {
                    return Some(format!("#{val}"));
                }
            }
        }
    }
    None
}

// --- Markdown ---

#[cfg(feature = "symbols-markdown")]
fn markdown_node_to_symbol(node: Node, source: &str, kind_str: &str) -> Option<Symbol> {
    match kind_str {
        "atx_heading" | "setext_heading" => {
            let heading_text = node_text(node, source).trim().to_owned();
            // Strip leading '#' markers and whitespace for name
            let name = heading_text.trim_start_matches('#').trim().to_owned();
            if name.is_empty() {
                return None;
            }
            // Use Module for headings as they represent document sections
            Some(Symbol {
                name,
                kind: SymbolKind::Module,
                start_line: node.start_position().row as u32 + 1,
                end_line: node.end_position().row as u32 + 1,
                children: vec![],
            })
        }
        _ => None,
    }
}

// --- Helpers ---

/// Get the text content of a node.
fn node_text<'a>(node: Node<'a>, source: &'a str) -> &'a str {
    &source[node.byte_range()]
}

/// Find a named child field and return its text.
fn find_child_text(node: Node, field: &str, source: &str) -> Option<String> {
    node.child_by_field_name(field)
        .map(|n| node_text(n, source).to_owned())
}

/// Find the name for a Rust `impl` block (e.g., "MyStruct" or "MyTrait for MyStruct").
#[cfg(feature = "symbols-rust-lang")]
fn find_impl_name(node: Node, source: &str) -> Option<String> {
    let type_node = node.child_by_field_name("type")?;
    let type_name = node_text(type_node, source).to_owned();

    // Check for trait impl: `impl Trait for Type`
    if let Some(trait_node) = node.child_by_field_name("trait") {
        let trait_name = node_text(trait_node, source).to_owned();
        Some(format!("{trait_name} for {type_name}"))
    } else {
        Some(type_name)
    }
}

/// Extract method symbols from a Rust trait/impl body.
#[cfg(feature = "symbols-rust-lang")]
fn extract_methods_from_body(parent: Node, source: &str, _ext: &str) -> Vec<Symbol> {
    let mut methods = Vec::new();
    let Some(body) = parent.child_by_field_name("body") else {
        return methods;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        if child.kind() == "function_item" {
            if let Some(name) = find_child_text(child, "name", source) {
                methods.push(Symbol {
                    name,
                    kind: SymbolKind::Method,
                    start_line: child.start_position().row as u32 + 1,
                    end_line: child.end_position().row as u32 + 1,
                    children: vec![],
                });
            }
        }
    }

    methods
}

/// Extract symbols from the body node of a container (module, etc.).
#[cfg(feature = "symbols-rust-lang")]
fn extract_symbols_from_body(parent: Node, source: &str, ext: &str) -> Vec<Symbol> {
    let mut symbols = Vec::new();
    let Some(body) = parent.child_by_field_name("body") else {
        return symbols;
    };

    let mut cursor = body.walk();
    for child in body.children(&mut cursor) {
        if let Some(sym) = node_to_symbol(child, source, ext) {
            symbols.push(sym);
        }
    }

    symbols
}

/// Map hunks to symbols based on line range overlap.
///
/// A hunk overlaps a symbol if the hunk's new-file line range intersects
/// the symbol's line range.
pub fn map_hunks_to_symbols(
    hunks: &[DiffHunk],
    symbols: &[Symbol],
    file_path: &str,
) -> (HashMap<String, Vec<String>>, Vec<String>) {
    let mut hunk_symbols: HashMap<String, Vec<String>> = HashMap::new();
    let mut top_level_hunk_ids: Vec<String> = Vec::new();

    // Flatten symbols including children for overlap checking
    let all_symbols = flatten_symbols(symbols);

    for hunk in hunks {
        if hunk.file_path != file_path {
            continue;
        }

        let hunk_start = hunk.new_start;
        let hunk_end = if hunk.new_count == 0 {
            hunk.new_start
        } else {
            hunk.new_start + hunk.new_count - 1
        };

        let mut matched_names: Vec<String> = Vec::new();

        for (name, start, end) in &all_symbols {
            if ranges_overlap(hunk_start, hunk_end, *start, *end) {
                matched_names.push(name.clone());
            }
        }

        if matched_names.is_empty() {
            top_level_hunk_ids.push(hunk.id.clone());
        } else {
            // Deduplicate
            matched_names.dedup();
            hunk_symbols.insert(hunk.id.clone(), matched_names);
        }
    }

    (hunk_symbols, top_level_hunk_ids)
}

/// Flatten a symbol tree into (name, start_line, end_line) tuples.
fn flatten_symbols(symbols: &[Symbol]) -> Vec<(String, u32, u32)> {
    let mut result = Vec::new();
    for sym in symbols {
        result.push((sym.name.clone(), sym.start_line, sym.end_line));
        for child in &sym.children {
            result.push((child.name.clone(), child.start_line, child.end_line));
        }
    }
    result
}

/// Check if two line ranges overlap (both inclusive).
fn ranges_overlap(a_start: u32, a_end: u32, b_start: u32, b_end: u32) -> bool {
    a_start <= b_end && b_start <= a_end
}

/// Compute a symbol-level diff for a single file.
///
/// Parses old and new versions with tree-sitter, matches symbols by (name, kind),
/// and categorizes each as added/removed/modified based on hunk overlap.
pub fn compute_file_symbol_diff(
    old_content: Option<&str>,
    new_content: Option<&str>,
    file_path: &str,
    hunks: &[DiffHunk],
) -> FileSymbolDiff {
    let file_hunks: Vec<&DiffHunk> = hunks.iter().filter(|h| h.file_path == file_path).collect();

    // Check if we have a grammar for this file type
    if get_language_for_file(file_path).is_none() {
        // No grammar - all hunks are top-level
        return FileSymbolDiff {
            file_path: file_path.to_owned(),
            symbols: vec![],
            top_level_hunk_ids: file_hunks.iter().map(|h| h.id.clone()).collect(),
            has_grammar: false,
        };
    }

    let old_symbols = old_content
        .and_then(|c| extract_symbols(c, file_path))
        .unwrap_or_default();
    let new_symbols = new_content
        .and_then(|c| extract_symbols(c, file_path))
        .unwrap_or_default();

    // Diff top-level symbols, tracking which hunks are consumed
    let mut consumed_hunk_ids: Vec<String> = Vec::new();
    let symbols = diff_symbol_lists(
        &old_symbols,
        &new_symbols,
        &file_hunks,
        &mut consumed_hunk_ids,
    );

    // Top-level hunks = file hunks not consumed by any symbol
    let top_level_hunk_ids: Vec<String> = file_hunks
        .iter()
        .map(|h| h.id.clone())
        .filter(|id| !consumed_hunk_ids.contains(id))
        .collect();

    FileSymbolDiff {
        file_path: file_path.to_owned(),
        symbols,
        top_level_hunk_ids,
        has_grammar: true,
    }
}

/// Diff two lists of symbols, matching by (name, kind).
/// Returns only symbols that have changed (added/removed/modified).
fn diff_symbol_lists(
    old_symbols: &[Symbol],
    new_symbols: &[Symbol],
    hunks: &[&DiffHunk],
    consumed_hunk_ids: &mut Vec<String>,
) -> Vec<SymbolDiff> {
    let mut result = Vec::new();
    let mut old_matched = vec![false; old_symbols.len()];
    let mut new_matched = vec![false; new_symbols.len()];

    // Match by (name, kind) - first match wins, positional order for duplicates
    for (ni, new_sym) in new_symbols.iter().enumerate() {
        for (oi, old_sym) in old_symbols.iter().enumerate() {
            if old_matched[oi] {
                continue;
            }
            if old_sym.name == new_sym.name && old_sym.kind == new_sym.kind {
                old_matched[oi] = true;
                new_matched[ni] = true;

                // Matched pair - check if modified (any hunk overlaps old or new range)
                let overlapping: Vec<String> = hunks
                    .iter()
                    .filter(|h| {
                        hunk_overlaps_old_range(h, old_sym.start_line, old_sym.end_line)
                            || hunk_overlaps_new_range(h, new_sym.start_line, new_sym.end_line)
                    })
                    .map(|h| h.id.clone())
                    .collect();

                // Recursively diff children for container symbols
                let child_diffs = if !old_sym.children.is_empty() || !new_sym.children.is_empty() {
                    // For children, filter hunks to those within the container range
                    let child_hunks: Vec<&DiffHunk> = hunks
                        .iter()
                        .filter(|h| {
                            hunk_overlaps_old_range(h, old_sym.start_line, old_sym.end_line)
                                || hunk_overlaps_new_range(h, new_sym.start_line, new_sym.end_line)
                        })
                        .copied()
                        .collect();
                    diff_symbol_lists(
                        &old_sym.children,
                        &new_sym.children,
                        &child_hunks,
                        consumed_hunk_ids,
                    )
                } else {
                    vec![]
                };

                if !overlapping.is_empty() || !child_diffs.is_empty() {
                    consumed_hunk_ids.extend(overlapping.iter().cloned());
                    result.push(SymbolDiff {
                        name: new_sym.name.clone(),
                        kind: Some(new_sym.kind.clone()),
                        change_type: SymbolChangeType::Modified,
                        hunk_ids: overlapping,
                        children: child_diffs,
                        old_range: Some(LineRange {
                            start_line: old_sym.start_line,
                            end_line: old_sym.end_line,
                        }),
                        new_range: Some(LineRange {
                            start_line: new_sym.start_line,
                            end_line: new_sym.end_line,
                        }),
                    });
                }

                break;
            }
        }
    }

    // Unmatched new symbols → Added
    for (ni, new_sym) in new_symbols.iter().enumerate() {
        if new_matched[ni] {
            continue;
        }
        let overlapping: Vec<String> = hunks
            .iter()
            .filter(|h| hunk_overlaps_new_range(h, new_sym.start_line, new_sym.end_line))
            .map(|h| h.id.clone())
            .collect();
        consumed_hunk_ids.extend(overlapping.iter().cloned());

        // Children of added symbols are all added too
        let child_diffs: Vec<SymbolDiff> = new_sym
            .children
            .iter()
            .map(|child| {
                let child_overlapping: Vec<String> = hunks
                    .iter()
                    .filter(|h| hunk_overlaps_new_range(h, child.start_line, child.end_line))
                    .map(|h| h.id.clone())
                    .collect();
                consumed_hunk_ids.extend(child_overlapping.iter().cloned());
                SymbolDiff {
                    name: child.name.clone(),
                    kind: Some(child.kind.clone()),
                    change_type: SymbolChangeType::Added,
                    hunk_ids: child_overlapping,
                    children: vec![],
                    old_range: None,
                    new_range: Some(LineRange {
                        start_line: child.start_line,
                        end_line: child.end_line,
                    }),
                }
            })
            .collect();

        result.push(SymbolDiff {
            name: new_sym.name.clone(),
            kind: Some(new_sym.kind.clone()),
            change_type: SymbolChangeType::Added,
            hunk_ids: overlapping,
            children: child_diffs,
            old_range: None,
            new_range: Some(LineRange {
                start_line: new_sym.start_line,
                end_line: new_sym.end_line,
            }),
        });
    }

    // Unmatched old symbols → Removed
    for (oi, old_sym) in old_symbols.iter().enumerate() {
        if old_matched[oi] {
            continue;
        }
        let overlapping: Vec<String> = hunks
            .iter()
            .filter(|h| hunk_overlaps_old_range(h, old_sym.start_line, old_sym.end_line))
            .map(|h| h.id.clone())
            .collect();
        consumed_hunk_ids.extend(overlapping.iter().cloned());

        // Children of removed symbols are all removed too
        let child_diffs: Vec<SymbolDiff> = old_sym
            .children
            .iter()
            .map(|child| {
                let child_overlapping: Vec<String> = hunks
                    .iter()
                    .filter(|h| hunk_overlaps_old_range(h, child.start_line, child.end_line))
                    .map(|h| h.id.clone())
                    .collect();
                consumed_hunk_ids.extend(child_overlapping.iter().cloned());
                SymbolDiff {
                    name: child.name.clone(),
                    kind: Some(child.kind.clone()),
                    change_type: SymbolChangeType::Removed,
                    hunk_ids: child_overlapping,
                    children: vec![],
                    old_range: Some(LineRange {
                        start_line: child.start_line,
                        end_line: child.end_line,
                    }),
                    new_range: None,
                }
            })
            .collect();

        result.push(SymbolDiff {
            name: old_sym.name.clone(),
            kind: Some(old_sym.kind.clone()),
            change_type: SymbolChangeType::Removed,
            hunk_ids: overlapping,
            children: child_diffs,
            old_range: Some(LineRange {
                start_line: old_sym.start_line,
                end_line: old_sym.end_line,
            }),
            new_range: None,
        });
    }

    result
}

/// Check if a hunk's old-side range overlaps a symbol range.
fn hunk_overlaps_old_range(hunk: &DiffHunk, sym_start: u32, sym_end: u32) -> bool {
    if hunk.old_count == 0 {
        return false;
    }
    let hunk_end = hunk.old_start + hunk.old_count - 1;
    ranges_overlap(hunk.old_start, hunk_end, sym_start, sym_end)
}

/// Check if a hunk's new-side range overlaps a symbol range.
fn hunk_overlaps_new_range(hunk: &DiffHunk, sym_start: u32, sym_end: u32) -> bool {
    if hunk.new_count == 0 {
        return false;
    }
    let hunk_end = hunk.new_start + hunk.new_count - 1;
    ranges_overlap(hunk.new_start, hunk_end, sym_start, sym_end)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "symbols-rust-lang")]
    #[test]
    fn test_extract_rust_symbols() {
        let source = r#"
fn hello() {
    println!("hello");
}

struct Foo {
    x: i32,
}

impl Foo {
    fn new() -> Self {
        Foo { x: 0 }
    }

    fn value(&self) -> i32 {
        self.x
    }
}

trait Bar {
    fn do_thing(&self);
}
"#;
        let symbols = extract_symbols(source, "test.rs").unwrap();
        assert!(symbols.len() >= 4); // hello, Foo, impl Foo, Bar

        let func = symbols.iter().find(|s| s.name == "hello").unwrap();
        assert_eq!(func.kind, SymbolKind::Function);

        let struct_sym = symbols
            .iter()
            .find(|s| s.name == "Foo" && s.kind == SymbolKind::Struct)
            .unwrap();
        assert!(struct_sym.children.is_empty());

        let impl_sym = symbols.iter().find(|s| s.kind == SymbolKind::Impl).unwrap();
        assert_eq!(impl_sym.children.len(), 2); // new, value
    }

    #[cfg(feature = "symbols-python")]
    #[test]
    fn test_extract_python_symbols() {
        let source = r#"
def hello():
    pass

class MyClass:
    def __init__(self):
        pass

    def method(self):
        pass
"#;
        let symbols = extract_symbols(source, "test.py").unwrap();
        assert!(symbols.len() >= 2);

        let func = symbols.iter().find(|s| s.name == "hello").unwrap();
        assert_eq!(func.kind, SymbolKind::Function);

        let class = symbols.iter().find(|s| s.name == "MyClass").unwrap();
        assert_eq!(class.kind, SymbolKind::Class);
        assert_eq!(class.children.len(), 2);
    }

    #[cfg(feature = "symbols-typescript")]
    #[test]
    fn test_extract_js_symbols() {
        let source = r#"
function hello() {
    console.log("hello");
}

class MyClass {
    constructor() {}
    method() {}
}
"#;
        let symbols = extract_symbols(source, "test.js").unwrap();
        assert!(symbols.len() >= 2);

        let func = symbols.iter().find(|s| s.name == "hello").unwrap();
        assert_eq!(func.kind, SymbolKind::Function);

        let class = symbols.iter().find(|s| s.name == "MyClass").unwrap();
        assert_eq!(class.kind, SymbolKind::Class);
    }

    #[cfg(feature = "symbols-typescript")]
    #[test]
    fn test_extract_ts_symbols() {
        let source = r#"
interface Config {
    name: string;
}

function process(config: Config): void {
    console.log(config.name);
}

type Result = string | number;
"#;
        let symbols = extract_symbols(source, "test.ts").unwrap();
        assert!(symbols.len() >= 3);

        let iface = symbols.iter().find(|s| s.name == "Config").unwrap();
        assert_eq!(iface.kind, SymbolKind::Interface);

        let type_sym = symbols.iter().find(|s| s.name == "Result").unwrap();
        assert_eq!(type_sym.kind, SymbolKind::Type);
    }

    #[cfg(feature = "symbols-go")]
    #[test]
    fn test_extract_go_symbols() {
        let source = r#"
package main

func Hello() {
    fmt.Println("hello")
}

type Server struct {
    Port int
}

func (s *Server) Start() {
    // start
}
"#;
        let symbols = extract_symbols(source, "test.go").unwrap();
        assert!(symbols.len() >= 3);

        let func = symbols.iter().find(|s| s.name == "Hello").unwrap();
        assert_eq!(func.kind, SymbolKind::Function);

        let struct_sym = symbols.iter().find(|s| s.name == "Server").unwrap();
        assert_eq!(struct_sym.kind, SymbolKind::Struct);

        let method = symbols.iter().find(|s| s.name.contains("Start")).unwrap();
        assert_eq!(method.kind, SymbolKind::Method);
    }

    #[test]
    fn test_no_grammar_returns_none() {
        assert!(extract_symbols("hello", "test.json").is_none());
        #[cfg(not(feature = "symbols-markdown"))]
        assert!(extract_symbols("hello", "test.md").is_none());
    }

    #[test]
    fn test_ranges_overlap() {
        assert!(ranges_overlap(1, 5, 3, 7));
        assert!(ranges_overlap(3, 7, 1, 5));
        assert!(ranges_overlap(1, 5, 5, 10));
        assert!(!ranges_overlap(1, 5, 6, 10));
        assert!(ranges_overlap(1, 10, 3, 7)); // contained
    }

    #[test]
    fn test_map_hunks_to_symbols() {
        let symbols = vec![
            Symbol {
                name: "hello".to_string(),
                kind: SymbolKind::Function,
                start_line: 2,
                end_line: 5,
                children: vec![],
            },
            Symbol {
                name: "world".to_string(),
                kind: SymbolKind::Function,
                start_line: 10,
                end_line: 15,
                children: vec![],
            },
        ];

        let hunks = vec![
            DiffHunk {
                id: "test.rs:abc".to_string(),
                file_path: "test.rs".to_string(),
                old_start: 2,
                old_count: 3,
                new_start: 3,
                new_count: 3,
                content: String::new(),
                lines: vec![],
                content_hash: String::new(),
                move_pair_id: None,
            },
            DiffHunk {
                id: "test.rs:def".to_string(),
                file_path: "test.rs".to_string(),
                old_start: 20,
                old_count: 2,
                new_start: 20,
                new_count: 2,
                content: String::new(),
                lines: vec![],
                content_hash: String::new(),
                move_pair_id: None,
            },
        ];

        let (hunk_syms, top_level) = map_hunks_to_symbols(&hunks, &symbols, "test.rs");

        assert!(hunk_syms.contains_key("test.rs:abc"));
        assert_eq!(hunk_syms["test.rs:abc"], vec!["hello".to_string()]);
        assert_eq!(top_level, vec!["test.rs:def".to_string()]);
    }

    #[cfg(feature = "symbols-typescript")]
    #[test]
    fn test_arrow_function_extraction() {
        let source = r#"
const greet = (name) => {
    console.log(name);
};

const add = function(a, b) {
    return a + b;
};
"#;
        let symbols = extract_symbols(source, "test.js").unwrap();
        assert!(symbols.len() >= 2);

        let greet = symbols.iter().find(|s| s.name == "greet").unwrap();
        assert_eq!(greet.kind, SymbolKind::Function);

        let add = symbols.iter().find(|s| s.name == "add").unwrap();
        assert_eq!(add.kind, SymbolKind::Function);
    }

    // --- compute_file_symbol_diff tests ---

    fn make_hunk(
        id: &str,
        file: &str,
        old_start: u32,
        old_count: u32,
        new_start: u32,
        new_count: u32,
    ) -> DiffHunk {
        DiffHunk {
            id: id.to_string(),
            file_path: file.to_string(),
            old_start,
            old_count,
            new_start,
            new_count,
            content: String::new(),
            lines: vec![],
            content_hash: String::new(),
            move_pair_id: None,
        }
    }

    #[cfg(feature = "symbols-rust-lang")]
    #[test]
    fn test_diff_function_added() {
        let old_src = "fn existing() {\n    1\n}\n";
        let new_src = "fn existing() {\n    1\n}\n\nfn new_func() {\n    2\n}\n";
        // Hunk covers lines 5-7 in new file (the added function)
        let hunks = vec![make_hunk("f:h1", "test.rs", 3, 0, 4, 4)];
        let result = compute_file_symbol_diff(Some(old_src), Some(new_src), "test.rs", &hunks);

        assert!(result.has_grammar);
        let added = result
            .symbols
            .iter()
            .find(|s| s.name == "new_func")
            .unwrap();
        assert_eq!(added.change_type, SymbolChangeType::Added);
        assert!(added.new_range.is_some());
        assert!(added.old_range.is_none());
        // existing() should NOT appear (unchanged)
        assert!(result
            .symbols
            .iter()
            .find(|s| s.name == "existing")
            .is_none());
    }

    #[cfg(feature = "symbols-rust-lang")]
    #[test]
    fn test_diff_function_removed() {
        let old_src = "fn existing() {\n    1\n}\n\nfn old_func() {\n    2\n}\n";
        let new_src = "fn existing() {\n    1\n}\n";
        // Hunk covers lines 5-7 in old file (the removed function)
        let hunks = vec![make_hunk("f:h1", "test.rs", 4, 4, 3, 0)];
        let result = compute_file_symbol_diff(Some(old_src), Some(new_src), "test.rs", &hunks);

        let removed = result
            .symbols
            .iter()
            .find(|s| s.name == "old_func")
            .unwrap();
        assert_eq!(removed.change_type, SymbolChangeType::Removed);
        assert!(removed.old_range.is_some());
        assert!(removed.new_range.is_none());
    }

    #[cfg(feature = "symbols-rust-lang")]
    #[test]
    fn test_diff_function_modified() {
        let old_src = "fn hello() {\n    println!(\"old\");\n}\n";
        let new_src = "fn hello() {\n    println!(\"new\");\n}\n";
        // Hunk modifies line 2
        let hunks = vec![make_hunk("f:h1", "test.rs", 2, 1, 2, 1)];
        let result = compute_file_symbol_diff(Some(old_src), Some(new_src), "test.rs", &hunks);

        assert_eq!(result.symbols.len(), 1);
        assert_eq!(result.symbols[0].name, "hello");
        assert_eq!(result.symbols[0].change_type, SymbolChangeType::Modified);
        assert!(result.symbols[0].old_range.is_some());
        assert!(result.symbols[0].new_range.is_some());
    }

    #[cfg(feature = "symbols-rust-lang")]
    #[test]
    fn test_diff_unchanged_excluded() {
        let src = "fn unchanged() {\n    1\n}\n\nfn modified() {\n    2\n}\n";
        let new_src = "fn unchanged() {\n    1\n}\n\nfn modified() {\n    3\n}\n";
        // Only hunk is in modified() range
        let hunks = vec![make_hunk("f:h1", "test.rs", 6, 1, 6, 1)];
        let result = compute_file_symbol_diff(Some(src), Some(new_src), "test.rs", &hunks);

        assert_eq!(result.symbols.len(), 1);
        assert_eq!(result.symbols[0].name, "modified");
        // unchanged should not appear
        assert!(result
            .symbols
            .iter()
            .find(|s| s.name == "unchanged")
            .is_none());
    }

    #[cfg(feature = "symbols-rust-lang")]
    #[test]
    fn test_diff_new_file() {
        let new_src = "fn brand_new() {\n    1\n}\n";
        let hunks = vec![make_hunk("f:h1", "test.rs", 0, 0, 1, 3)];
        let result = compute_file_symbol_diff(None, Some(new_src), "test.rs", &hunks);

        assert_eq!(result.symbols.len(), 1);
        assert_eq!(result.symbols[0].change_type, SymbolChangeType::Added);
    }

    #[cfg(feature = "symbols-rust-lang")]
    #[test]
    fn test_diff_deleted_file() {
        let old_src = "fn going_away() {\n    1\n}\n";
        let hunks = vec![make_hunk("f:h1", "test.rs", 1, 3, 0, 0)];
        let result = compute_file_symbol_diff(Some(old_src), None, "test.rs", &hunks);

        assert_eq!(result.symbols.len(), 1);
        assert_eq!(result.symbols[0].change_type, SymbolChangeType::Removed);
    }

    #[test]
    fn test_diff_no_grammar() {
        let hunks = vec![make_hunk("f:h1", "data.json", 1, 2, 1, 3)];
        let result = compute_file_symbol_diff(Some("{}"), Some("{\"a\":1}"), "data.json", &hunks);

        assert!(!result.has_grammar);
        assert!(result.symbols.is_empty());
        assert_eq!(result.top_level_hunk_ids, vec!["f:h1"]);
    }

    #[cfg(feature = "symbols-python")]
    #[test]
    fn test_diff_python_class_with_methods() {
        let old_src =
            "class Svc:\n    def alpha(self):\n        pass\n\n    def beta(self):\n        pass\n";
        let new_src = "class Svc:\n    def alpha(self):\n        pass\n\n    def gamma(self):\n        pass\n";
        // beta removed, gamma added (hunk covers lines 5-6 in both old and new)
        let hunks = vec![make_hunk("f:h1", "test.py", 5, 2, 5, 2)];
        let result = compute_file_symbol_diff(Some(old_src), Some(new_src), "test.py", &hunks);

        // The class itself should show as modified with child diffs
        let class_sym = result.symbols.iter().find(|s| s.name == "Svc").unwrap();
        assert_eq!(class_sym.change_type, SymbolChangeType::Modified);

        let removed_child = class_sym.children.iter().find(|s| s.name == "beta");
        assert!(removed_child.is_some());
        assert_eq!(
            removed_child.unwrap().change_type,
            SymbolChangeType::Removed
        );

        let added_child = class_sym.children.iter().find(|s| s.name == "gamma");
        assert!(added_child.is_some());
        assert_eq!(added_child.unwrap().change_type, SymbolChangeType::Added);

        // alpha should not appear in children (unchanged)
        assert!(class_sym
            .children
            .iter()
            .find(|s| s.name == "alpha")
            .is_none());
    }

    #[cfg(feature = "symbols-rust-lang")]
    #[test]
    fn test_diff_top_level_hunks() {
        let old_src = "// header\n\nfn hello() {\n    1\n}\n";
        let new_src = "// new header\n\nfn hello() {\n    1\n}\n";
        // Hunk is on line 1 (header comment), outside any symbol
        let hunks = vec![make_hunk("f:h1", "test.rs", 1, 1, 1, 1)];
        let result = compute_file_symbol_diff(Some(old_src), Some(new_src), "test.rs", &hunks);

        // hello is unchanged, so no symbols
        assert!(result.symbols.is_empty());
        // The header hunk should be top-level
        assert_eq!(result.top_level_hunk_ids, vec!["f:h1"]);
    }

    // --- New language tests ---

    #[cfg(feature = "symbols-ruby")]
    #[test]
    fn test_extract_ruby_symbols() {
        let source = r#"
module Greetings
  class Hello
    def initialize(name)
      @name = name
    end

    def greet
      puts @name
    end

    def self.create(name)
      new(name)
    end
  end

  def helper
    true
  end
end
"#;
        let symbols = extract_symbols(source, "test.rb").unwrap();
        assert!(!symbols.is_empty());

        let module = symbols.iter().find(|s| s.name == "Greetings").unwrap();
        assert_eq!(module.kind, SymbolKind::Module);

        // Module should contain the class and helper method
        let class = module.children.iter().find(|s| s.name == "Hello").unwrap();
        assert_eq!(class.kind, SymbolKind::Class);
        assert!(class.children.len() >= 2); // initialize, greet, self.create
    }

    #[cfg(feature = "symbols-java")]
    #[test]
    fn test_extract_java_symbols() {
        let source = r#"
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }

    public int subtract(int a, int b) {
        return a - b;
    }
}

interface Computable {
    int compute();
}

enum Operation {
    ADD, SUBTRACT
}
"#;
        let symbols = extract_symbols(source, "test.java").unwrap();
        assert!(symbols.len() >= 3);

        let class = symbols.iter().find(|s| s.name == "Calculator").unwrap();
        assert_eq!(class.kind, SymbolKind::Class);
        assert_eq!(class.children.len(), 2); // add, subtract

        let iface = symbols.iter().find(|s| s.name == "Computable").unwrap();
        assert_eq!(iface.kind, SymbolKind::Interface);

        let enum_sym = symbols.iter().find(|s| s.name == "Operation").unwrap();
        assert_eq!(enum_sym.kind, SymbolKind::Enum);
    }

    #[cfg(feature = "symbols-c")]
    #[test]
    fn test_extract_c_symbols() {
        let source = r#"
struct Point {
    int x;
    int y;
};

enum Color {
    RED,
    GREEN,
    BLUE
};

typedef int Number;

int add(int a, int b) {
    return a + b;
}

void greet(const char* name) {
    printf("Hello, %s\n", name);
}
"#;
        let symbols = extract_symbols(source, "test.c").unwrap();
        assert!(symbols.len() >= 4);

        let struct_sym = symbols.iter().find(|s| s.name == "Point").unwrap();
        assert_eq!(struct_sym.kind, SymbolKind::Struct);

        let enum_sym = symbols.iter().find(|s| s.name == "Color").unwrap();
        assert_eq!(enum_sym.kind, SymbolKind::Enum);

        let func = symbols.iter().find(|s| s.name == "add").unwrap();
        assert_eq!(func.kind, SymbolKind::Function);

        let greet = symbols.iter().find(|s| s.name == "greet").unwrap();
        assert_eq!(greet.kind, SymbolKind::Function);
    }

    #[cfg(feature = "symbols-cpp")]
    #[test]
    fn test_extract_cpp_symbols() {
        let source = r#"
namespace math {

class Calculator {
public:
    int add(int a, int b) {
        return a + b;
    }
};

}

struct Point {
    int x;
    int y;
};

int helper() {
    return 42;
}
"#;
        let symbols = extract_symbols(source, "test.cpp").unwrap();
        assert!(symbols.len() >= 3);

        let ns = symbols.iter().find(|s| s.name == "math").unwrap();
        assert_eq!(ns.kind, SymbolKind::Module);
        // namespace should contain Calculator
        let calc = ns.children.iter().find(|s| s.name == "Calculator").unwrap();
        assert_eq!(calc.kind, SymbolKind::Class);

        let struct_sym = symbols.iter().find(|s| s.name == "Point").unwrap();
        assert_eq!(struct_sym.kind, SymbolKind::Struct);

        let func = symbols.iter().find(|s| s.name == "helper").unwrap();
        assert_eq!(func.kind, SymbolKind::Function);
    }

    #[cfg(feature = "symbols-csharp")]
    #[test]
    fn test_extract_csharp_symbols() {
        let source = r#"
namespace MyApp {
    class Service {
        void Start() {
        }

        void Stop() {
        }
    }

    interface IRunnable {
    }

    struct Point {
    }

    enum Status {
        Active,
        Inactive
    }
}
"#;
        let symbols = extract_symbols(source, "test.cs").unwrap();
        assert!(!symbols.is_empty());

        let ns = symbols.iter().find(|s| s.name == "MyApp").unwrap();
        assert_eq!(ns.kind, SymbolKind::Module);

        // Namespace should contain Service, IRunnable, Point, Status
        let svc = ns.children.iter().find(|s| s.name == "Service").unwrap();
        assert_eq!(svc.kind, SymbolKind::Class);
        assert_eq!(svc.children.len(), 2); // Start, Stop

        let iface = ns.children.iter().find(|s| s.name == "IRunnable").unwrap();
        assert_eq!(iface.kind, SymbolKind::Interface);

        let struct_sym = ns.children.iter().find(|s| s.name == "Point").unwrap();
        assert_eq!(struct_sym.kind, SymbolKind::Struct);

        let enum_sym = ns.children.iter().find(|s| s.name == "Status").unwrap();
        assert_eq!(enum_sym.kind, SymbolKind::Enum);
    }

    #[cfg(feature = "symbols-php")]
    #[test]
    fn test_extract_php_symbols() {
        let source = r#"<?php

class UserService {
    public function getUser($id) {
        return null;
    }

    public function createUser($data) {
        return null;
    }
}

function helper() {
    return true;
}

interface Repository {
}

trait Cacheable {
    public function cache() {
    }
}
"#;
        let symbols = extract_symbols(source, "test.php").unwrap();
        assert!(symbols.len() >= 3);

        let class = symbols.iter().find(|s| s.name == "UserService").unwrap();
        assert_eq!(class.kind, SymbolKind::Class);
        assert_eq!(class.children.len(), 2); // getUser, createUser

        let func = symbols.iter().find(|s| s.name == "helper").unwrap();
        assert_eq!(func.kind, SymbolKind::Function);

        let iface = symbols.iter().find(|s| s.name == "Repository").unwrap();
        assert_eq!(iface.kind, SymbolKind::Interface);

        let trait_sym = symbols.iter().find(|s| s.name == "Cacheable").unwrap();
        assert_eq!(trait_sym.kind, SymbolKind::Trait);
    }

    #[cfg(feature = "symbols-css")]
    #[test]
    fn test_extract_css_symbols() {
        let source = r#"
.header {
    color: red;
}

#main {
    display: flex;
}

@media (max-width: 768px) {
    .header {
        color: blue;
    }
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
"#;
        let symbols = extract_symbols(source, "test.css").unwrap();
        assert!(symbols.len() >= 3);

        let header = symbols.iter().find(|s| s.name == ".header").unwrap();
        assert_eq!(header.kind, SymbolKind::Function);

        let main = symbols.iter().find(|s| s.name == "#main").unwrap();
        assert_eq!(main.kind, SymbolKind::Function);

        let keyframes = symbols.iter().find(|s| s.name == "fadeIn").unwrap();
        assert_eq!(keyframes.kind, SymbolKind::Function);

        let media = symbols
            .iter()
            .find(|s| s.kind == SymbolKind::Module)
            .unwrap();
        assert!(media.name.contains("@media"));
    }

    #[cfg(feature = "symbols-html")]
    #[test]
    fn test_extract_html_symbols() {
        let source = r#"<!DOCTYPE html>
<html>
<head>
    <style>
        body { margin: 0; }
    </style>
</head>
<body>
    <div id="app">
        <h1>Hello</h1>
    </div>
    <script>
        console.log("hello");
    </script>
</body>
</html>
"#;
        let symbols = extract_symbols(source, "test.html").unwrap();

        // Should find #app, <script>, <style>
        let app = symbols.iter().find(|s| s.name == "#app");
        assert!(app.is_some());

        let script = symbols.iter().find(|s| s.name == "<script>");
        assert!(script.is_some());

        let style = symbols.iter().find(|s| s.name == "<style>");
        assert!(style.is_some());
    }

    #[cfg(feature = "symbols-markdown")]
    #[test]
    fn test_extract_markdown_symbols() {
        let source = r#"# Introduction

Some text here.

## Getting Started

More text.

### Installation

Install steps.

## API Reference

API docs.
"#;
        let symbols = extract_symbols(source, "test.md").unwrap();
        assert!(symbols.len() >= 4);

        let intro = symbols.iter().find(|s| s.name == "Introduction").unwrap();
        assert_eq!(intro.kind, SymbolKind::Module);

        let getting_started = symbols
            .iter()
            .find(|s| s.name == "Getting Started")
            .unwrap();
        assert_eq!(getting_started.kind, SymbolKind::Module);

        let install = symbols.iter().find(|s| s.name == "Installation").unwrap();
        assert_eq!(install.kind, SymbolKind::Module);

        let api = symbols.iter().find(|s| s.name == "API Reference").unwrap();
        assert_eq!(api.kind, SymbolKind::Module);
    }
}
